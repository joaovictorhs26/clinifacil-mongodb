// A3: Redis como cache de login + estatisticas com estruturas probabilisticas.
//
//  Estrutura          Comandos                 Para que serve aqui
//  -----------------  -----------------------  ---------------------------------------------
//  Bloom Filter       BF.ADD / BF.EXISTS       "esse e-mail existe?" sem ir ao MongoDB
//  HyperLogLog        PFADD / PFCOUNT          conta usuarios UNICOS que entraram no dia
//  Count-Min Sketch   CMS.INCRBY / CMS.QUERY   conta quantas vezes cada funcionalidade foi usada
//  Cache comum        HSET + EXPIRE            guarda o usuario por 5 min (depois some sozinho)
//
// Precisa de Redis com os modulos de probabilisticos (Redis Stack / Redis Cloud).
import { createClient } from 'redis';
import { createHash } from 'node:crypto';

const hash = (senha) => createHash('sha256').update(senha).digest('hex');
const hoje = () => new Date().toISOString().slice(0, 10); // ex.: 2026-11-24

export async function conectarRedis() {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  return redis;
}

// Cria o Bloom e o Count-Min Sketch (se ja existirem, o Redis da erro e a gente ignora)
export async function prepararEstruturas(redis) {
  await redis.sendCommand(['BF.RESERVE', 'bf:emails', '0.01', '10000']).catch(() => {}); // 10.000 e-mails, 1% de erro
  await redis.sendCommand(['CMS.INITBYDIM', 'cms:uso', '2000', '5']).catch(() => {});    // tabela 2000 x 5
}

// Coloca todos os e-mails do MongoDB dentro do Bloom Filter
export async function carregarBloom(redis, db) {
  const usuarios = await db.collection('users').find().toArray();
  await redis.sendCommand(['BF.MADD', 'bf:emails', ...usuarios.map((u) => u.email)]);
  return usuarios.length;
}

// ---------------------------------------------------------------------------
// Login. Devolve { ok, origem }
//   origem = 'bloom' -> e-mail nao existe, barrado sem consultar nada
//   origem = 'cache' -> usuario veio do Redis (rapido)
//   origem = 'mongo' -> foi ao MongoDB e guardou no cache
// ---------------------------------------------------------------------------
export async function login(redis, db, email, senha) {
  // 1) Bloom Filter: se diz "nao existe", tem certeza
  if (!(await redis.sendCommand(['BF.EXISTS', 'bf:emails', email]))) {
    return { ok: false, origem: 'bloom' };
  }

  // 2) Cache: o usuario ja esta guardado no Redis?
  let usuario = await redis.hGetAll(`user:${email}`);
  let origem = 'cache';

  // 3) Se nao esta, busca no MongoDB e guarda no Redis por 5 minutos (300 segundos)
  if (!usuario.passwordHash) {
    origem = 'mongo';
    const doc = await db.collection('users').findOne({ email });
    if (!doc) return { ok: false, origem };
    usuario = { id: String(doc._id), clinicId: String(doc.clinicId), passwordHash: doc.passwordHash };
    await redis.hSet(`user:${email}`, usuario);
    await redis.expire(`user:${email}`, 300);
  }

  // 4) Confere a senha
  if (hash(senha) !== usuario.passwordHash) return { ok: false, origem };

  // 5) Deu certo: conta nas estatisticas
  await redis.pfAdd(`hll:ativos:${usuario.clinicId}:${hoje()}`, usuario.id); // HyperLogLog
  await registrarUso(redis, 'login');                                         // Count-Min Sketch
  return { ok: true, origem };
}

// Soma no contador de uma funcionalidade ("agendar", "login"...)
export async function registrarUso(redis, funcionalidade, vezes = 1) {
  await redis.sendCommand(['CMS.INCRBY', 'cms:uso', funcionalidade, String(vezes)]);
}

// Le as estatisticas
export async function estatisticas(redis, clinicId, funcionalidades) {
  const usuariosUnicosHoje = await redis.pfCount(`hll:ativos:${clinicId}:${hoje()}`);
  const contagens = await redis.sendCommand(['CMS.QUERY', 'cms:uso', ...funcionalidades]);
  const usoPorFuncionalidade = Object.fromEntries(funcionalidades.map((f, i) => [f, Number(contagens[i])]));
  return { usuariosUnicosHoje, usoPorFuncionalidade };
}

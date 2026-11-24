// A3: Redis como cache de login e estatisticas de uso, com estruturas probabilisticas.
//
//  Estrutura          Comandos                 Para que serve aqui
//  -----------------  -----------------------  ---------------------------------------------
//  Bloom Filter       BF.ADD / BF.EXISTS       "esse e-mail existe?" sem ir ao MongoDB
//  HyperLogLog        PFADD / PFCOUNT          conta usuarios UNICOS ativos no dia
//  Count-Min Sketch   CMS.INCRBY / CMS.QUERY   conta quantas vezes cada funcionalidade foi usada
//  Cache comum        HSET + EXPIRE            guarda o usuario por 5 min (depois some sozinho)
//
// Precisa de Redis com os modulos de probabilisticos (Redis Stack / Redis Cloud).
import { createClient } from 'redis';
import { createHash } from 'node:crypto';

const BF_KEY = 'bf:emails';
const CMS_KEY = 'cms:uso';
const TTL_CACHE = 300; // 5 minutos, em segundos

const hash = (senha) => createHash('sha256').update(senha).digest('hex');
const hoje = () => new Date().toISOString().slice(0, 10); // ex.: 2026-11-24

export async function conectarRedis(url = process.env.REDIS_URL) {
  if (!url) throw new Error('Defina REDIS_URL no arquivo .env');
  const redis = createClient({ url });
  redis.on('error', (e) => console.error('Erro no Redis:', e.message));
  await redis.connect();
  return redis;
}

// Cria o Bloom e o Count-Min Sketch (se ja existem, o Redis avisa e a gente ignora o aviso)
export async function prepararEstruturas(redis) {
  const ignora = (e) => { if (!/exists/i.test(e.message)) throw e; };
  // Bloom: 10.000 e-mails, aceitando 1% de erro
  await redis.sendCommand(['BF.RESERVE', BF_KEY, '0.01', '10000']).catch(ignora);
  // Count-Min Sketch: tabela de 2000 colunas x 5 linhas
  await redis.sendCommand(['CMS.INITBYDIM', CMS_KEY, '2000', '5']).catch(ignora);
}

// Coloca todos os e-mails do MongoDB dentro do Bloom Filter (roda ao iniciar o sistema)
export async function carregarBloom(redis, db) {
  const usuarios = await db.collection('users').find().toArray();
  await redis.sendCommand(['BF.MADD', BF_KEY, ...usuarios.map((u) => u.email)]);
  return usuarios.length;
}

// ---------------------------------------------------------------------------
// Login. Devolve { ok, motivo, origem }
//   origem = 'bloom' -> e-mail nao existe, barrado sem consultar nada
//   origem = 'cache' -> usuario veio do Redis
//   origem = 'mongo' -> foi ao MongoDB e guardou no cache
// ---------------------------------------------------------------------------
export async function login(redis, db, email, senha) {
  // 1) Bloom Filter: se ele diz "nao existe", tem certeza
  const existe = await redis.sendCommand(['BF.EXISTS', BF_KEY, email]);
  if (!existe) {
    await redis.incr('stats:barrado_bloom');
    return { ok: false, motivo: 'usuario inexistente', origem: 'bloom' };
  }

  // 2) Cache: procura o usuario guardado no Redis
  const chave = `user:${email}`;
  let usuario = await redis.hGetAll(chave);
  let origem = 'cache';

  if (!usuario.passwordHash) {
    // 3) Nao estava no cache: busca no MongoDB e guarda no Redis por 5 minutos
    origem = 'mongo';
    const doc = await db.collection('users').findOne({ email });
    if (!doc) return { ok: false, motivo: 'usuario inexistente', origem }; // o Bloom errou (1%)
    usuario = { id: String(doc._id), clinicId: String(doc.clinicId), passwordHash: doc.passwordHash };
    await redis.hSet(chave, usuario);
    await redis.expire(chave, TTL_CACHE);
    await redis.incr('stats:cache_miss');
  } else {
    await redis.incr('stats:cache_hit');
  }

  // 4) Confere a senha
  if (hash(senha) !== usuario.passwordHash) {
    return { ok: false, motivo: 'senha incorreta', origem };
  }

  // 5) Login ok: registra nas estatisticas
  await redis.pfAdd(`hll:ativos:${usuario.clinicId}:${hoje()}`, usuario.id); // HyperLogLog
  await registrarUso(redis, 'login');                                         // Count-Min Sketch
  return { ok: true, origem };
}

// Soma 1 (ou mais) no contador de uma funcionalidade ("agendar", "login"...)
export async function registrarUso(redis, funcionalidade, vezes = 1) {
  await redis.sendCommand(['CMS.INCRBY', CMS_KEY, funcionalidade, String(vezes)]);
}

// Le as estatisticas
export async function estatisticas(redis, clinicId, funcionalidades) {
  const usuariosUnicosHoje = await redis.pfCount(`hll:ativos:${clinicId}:${hoje()}`);

  const contagens = await redis.sendCommand(['CMS.QUERY', CMS_KEY, ...funcionalidades]);
  const usoPorFuncionalidade = Object.fromEntries(funcionalidades.map((f, i) => [f, Number(contagens[i])]));

  const hit = Number(await redis.get('stats:cache_hit')) || 0;
  const miss = Number(await redis.get('stats:cache_miss')) || 0;
  const barradosPeloBloom = Number(await redis.get('stats:barrado_bloom')) || 0;

  return { usuariosUnicosHoje, usoPorFuncionalidade, cacheHit: hit, cacheMiss: miss, barradosPeloBloom };
}

// A3: Redis como cache de login e estatisticas de uso, com estruturas probabilisticas.
//
//  Estrutura            Comando Redis         Para que serve aqui
//  -------------------  --------------------  ------------------------------------------------
//  Bloom Filter (BF)    BF.ADD / BF.EXISTS    "esse e-mail existe?" sem ir ao MongoDB
//  HyperLogLog (HLL)    PFADD / PFCOUNT       usuarios UNICOS ativos por dia (12 KB fixos)
//  Count-Min Sketch     CMS.INCRBY / CMS.QUERY  quantas vezes cada funcionalidade foi usada
//  (cache comum)        HSET + EXPIRE         dados do usuario guardados por 5 min (TTL)
//
// Precisa de Redis com os modulos de probabilisticos (Redis Stack / Redis Cloud).
import { createClient } from 'redis';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const TTL_CACHE_USUARIO = 300; // 5 minutos
const TTL_SESSAO = 3600;       // 1 hora
const BF_KEY = 'bf:emails';
const CMS_KEY = 'cms:uso';

const hoje = () => new Date().toISOString().slice(0, 10); // 2026-11-19

export async function conectarRedis(url = process.env.REDIS_URL) {
  if (!url) throw new Error('Defina REDIS_URL no arquivo .env');
  const redis = createClient({ url });
  redis.on('error', (e) => console.error('Erro no Redis:', e.message));
  await redis.connect();
  return redis;
}

// Cria as estruturas se ainda nao existirem (erro "item exists" e ignorado)
export async function prepararEstruturas(redis) {
  // Bloom: 10.000 e-mails com 1% de falsos positivos
  await redis.sendCommand(['BF.RESERVE', BF_KEY, '0.01', '10000']).catch(ignorarSeExiste);
  // Count-Min Sketch: largura 2000 x profundidade 5
  await redis.sendCommand(['CMS.INITBYDIM', CMS_KEY, '2000', '5']).catch(ignorarSeExiste);
}
function ignorarSeExiste(e) {
  if (!/exists/i.test(e.message)) throw e;
}

// Carrega todos os e-mails do MongoDB para o Bloom Filter (rodar ao iniciar o sistema)
export async function aquecerBloom(redis, db) {
  const emails = await db.collection('users').find({}, { projection: { email: 1 } }).toArray();
  if (emails.length) await redis.sendCommand(['BF.MADD', BF_KEY, ...emails.map((u) => u.email)]);
  return emails.length;
}

async function senhaConfere(senha, passwordHash) {
  const [salt, hash] = passwordHash.split(':');
  const calculado = await scryptAsync(senha, salt, 32);
  return timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

// ---------------------------------------------------------------------------
// Login com cache. Devolve { ok, motivo, origem, token }
//   origem = 'bloom'  -> barrado pelo Bloom, MongoDB nem foi consultado
//   origem = 'cache'  -> usuario veio do Redis
//   origem = 'mongo'  -> foi ao MongoDB e guardou no cache
// ---------------------------------------------------------------------------
export async function login(redis, db, email, senha) {
  // 1) Bloom Filter: se diz "nao existe", e certeza. Nao gasta cache nem banco.
  const existe = await redis.sendCommand(['BF.EXISTS', BF_KEY, email]);
  if (!existe) {
    await redis.incr('stats:login:barrado_bloom');
    return { ok: false, motivo: 'usuario inexistente', origem: 'bloom' };
  }

  // 2) Cache: dados do usuario guardados em um hash com TTL
  const chave = `user:${email}`;
  let usuario = await redis.hGetAll(chave);
  let origem = 'cache';

  if (!usuario.passwordHash) {
    // 3) Cache miss: busca no MongoDB e guarda no Redis
    origem = 'mongo';
    const doc = await db.collection('users').findOne({ email });
    if (!doc) {
      // o Bloom pode errar para mais (falso positivo): o MongoDB tira a duvida
      await redis.incr('stats:login:falso_positivo_bloom');
      return { ok: false, motivo: 'usuario inexistente', origem };
    }
    usuario = { id: String(doc._id), clinicId: String(doc.clinicId), role: doc.role, passwordHash: doc.passwordHash };
    await redis.hSet(chave, usuario);
    await redis.expire(chave, TTL_CACHE_USUARIO);
    await redis.incr('stats:login:cache_miss');
  } else {
    await redis.incr('stats:login:cache_hit');
  }

  if (!(await senhaConfere(senha, usuario.passwordHash))) {
    await redis.incr('stats:login:senha_errada');
    return { ok: false, motivo: 'senha incorreta', origem };
  }

  // 4) Sucesso: cria sessao e registra as estatisticas
  const token = randomBytes(24).toString('hex');
  await redis.set(`sessao:${token}`, usuario.id, { EX: TTL_SESSAO });
  await redis.pfAdd(`hll:ativos:${usuario.clinicId}:${hoje()}`, usuario.id); // HyperLogLog
  await registrarUso(redis, 'login');                                         // Count-Min Sketch
  return { ok: true, origem, token, role: usuario.role };
}

// Conta o uso de uma funcionalidade ("agendar", "login", "relatorio"...) no Count-Min Sketch
export async function registrarUso(redis, funcionalidade, vezes = 1) {
  await redis.sendCommand(['CMS.INCRBY', CMS_KEY, funcionalidade, String(vezes)]);
}

// Estatisticas de uso do sistema
export async function estatisticas(redis, clinicId, funcionalidades) {
  const ativosHoje = await redis.pfCount(`hll:ativos:${clinicId}:${hoje()}`);
  const contagens = await redis.sendCommand(['CMS.QUERY', CMS_KEY, ...funcionalidades]);
  const uso = Object.fromEntries(funcionalidades.map((f, i) => [f, Number(contagens[i])]));

  const [hit, miss, barrado, errada, falsoPos] = (
    await redis.mGet([
      'stats:login:cache_hit', 'stats:login:cache_miss', 'stats:login:barrado_bloom',
      'stats:login:senha_errada', 'stats:login:falso_positivo_bloom',
    ])
  ).map((v) => Number(v ?? 0));

  return {
    usuariosUnicosAtivosHoje: ativosHoje,
    usoPorFuncionalidade: uso,
    login: {
      cacheHit: hit, cacheMiss: miss,
      taxaAcertoCachePct: hit + miss ? Math.round((hit / (hit + miss)) * 1000) / 10 : 0,
      barradosPeloBloom: barrado, falsosPositivosBloom: falsoPos, senhaErrada: errada,
    },
  };
}

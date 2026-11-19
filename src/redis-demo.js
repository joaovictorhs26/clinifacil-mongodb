// Demonstracao do A3: simula logins e uso do sistema e mostra as estatisticas.
// Uso: npm run redis-demo
import { MongoClient } from 'mongodb';
import { conectarRedis, prepararEstruturas, aquecerBloom, login, registrarUso, estatisticas } from './redis-cache.js';

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('clinifacil');
const redis = await conectarRedis();

const clinic = await db.collection('clinics').findOne({ cnpj: '12345678000190' });

await prepararEstruturas(redis);
const n = await aquecerBloom(redis, db);
console.log(`Bloom Filter carregado com ${n} e-mails.\n`);

// 1) Logins: 25 usuarios validos (2 vezes cada: 1a vai ao Mongo, 2a vem do cache)
const resultados = [];
for (let rodada = 1; rodada <= 2; rodada++) {
  for (let i = 1; i <= 25; i++) {
    resultados.push(await login(redis, db, `usuario${i}@sorrisopleno.com`, 'senha123'));
  }
}
// 2) Tentativas com e-mails que nao existem (ataque / digitacao errada)
for (let i = 1; i <= 10; i++) {
  resultados.push(await login(redis, db, `invasor${i}@teste.com`, 'qualquer'));
}
// 3) Senha errada
resultados.push(await login(redis, db, 'usuario1@sorrisopleno.com', 'errada'));

const porOrigem = {};
for (const r of resultados) porOrigem[r.origem] = (porOrigem[r.origem] ?? 0) + 1;
console.log('Logins por origem da resposta:', porOrigem);

// 4) Uso de funcionalidades (Count-Min Sketch)
await registrarUso(redis, 'agendar', 120);
await registrarUso(redis, 'remarcar', 35);
await registrarUso(redis, 'relatorio', 12);

console.log('\nEstatisticas:');
console.dir(await estatisticas(redis, String(clinic._id), ['login', 'agendar', 'remarcar', 'relatorio', 'nunca-usada']), { depth: null });

await redis.quit();
await mongo.close();

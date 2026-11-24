// Demonstracao do A3: simula logins e uso do sistema e mostra as estatisticas.
// Uso: npm run redis-demo
import { MongoClient } from 'mongodb';
import { conectarRedis, prepararEstruturas, carregarBloom, login, registrarUso, estatisticas } from './redis-cache.js';

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('clinifacil');
const redis = await conectarRedis();
const clinic = await db.collection('clinics').findOne({ cnpj: '12345678000190' });

await prepararEstruturas(redis);
console.log(`Bloom Filter carregado com ${await carregarBloom(redis, db)} e-mails.\n`);

const origens = { bloom: 0, cache: 0, mongo: 0 }; // quantos logins foram resolvidos por cada um

// 1) 25 usuarios entram 2 vezes: a 1a vai ao MongoDB, a 2a vem do cache
for (let rodada = 1; rodada <= 2; rodada++) {
  for (let i = 1; i <= 25; i++) {
    origens[(await login(redis, db, `usuario${i}@sorrisopleno.com`, 'senha123')).origem]++;
  }
}

// 2) E-mails que nao existem: o Bloom Filter barra
for (let i = 1; i <= 10; i++) {
  origens[(await login(redis, db, `invasor${i}@teste.com`, 'qualquer')).origem]++;
}

console.log('Logins resolvidos por:', origens);

// 3) Uso de funcionalidades (Count-Min Sketch)
await registrarUso(redis, 'agendar', 120);
await registrarUso(redis, 'remarcar', 35);

console.log('\nEstatisticas:', await estatisticas(redis, String(clinic._id), ['login', 'agendar', 'remarcar', 'nunca-usada']));

await redis.quit();
await mongo.close();

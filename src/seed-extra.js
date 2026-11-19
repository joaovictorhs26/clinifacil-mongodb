// Gera dados extras (pacientes, agendamentos, conversas e usuarios) para as
// pipelines (A2) e o cache Redis (A3) terem o que analisar.
// Roda depois do "npm run setup". Pode rodar varias vezes: apaga so o que ele mesmo criou (seed: true).
// Uso: npm run seed
import { MongoClient } from 'mongodb';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(senha, salt, 32)).toString('hex');
  return `${salt}:${hash}`;
}

// Gerador pseudo-aleatorio com semente fixa: os dados saem iguais a cada execucao
let estado = 42;
const rand = () => ((estado = (estado * 1664525 + 1013904223) % 4294967296) / 4294967296);
const escolhe = (lista) => lista[Math.floor(rand() * lista.length)];

export async function seed(db) {
  const clinic = await db.collection('clinics').findOne({ cnpj: '12345678000190' });
  if (!clinic) throw new Error('Rode "npm run setup" antes: a clinica de exemplo nao existe.');
  const clinicId = clinic._id;

  // limpa o que este script criou antes
  for (const nome of ['professionals', 'patients', 'appointments', 'conversations', 'users']) {
    await db.collection(nome).deleteMany({ seed: true });
  }

  // ---- profissionais ----
  const profs = [
    { name: 'Dr. Bruno Lima', specialty: 'Ortodontia' },
    { name: 'Dra. Carla Mendes', specialty: 'Estetica dental' },
    { name: 'Dr. Diego Alves', specialty: 'Endodontia' },
  ].map((p) => ({ clinicId, ...p, workingHours: [{ weekday: 2, start: '09:00', end: '18:00' }], seed: true }));
  const { insertedIds } = await db.collection('professionals').insertMany(profs);
  const todosProfs = [
    await db.collection('professionals').findOne({ clinicId, name: 'Dra. Ana Souza' }),
    ...profs.map((p, i) => ({ ...p, _id: insertedIds[i] })),
  ].filter(Boolean);

  // ---- pacientes ----
  const nomes = ['Joao', 'Maria', 'Pedro', 'Ana', 'Lucas', 'Julia', 'Rafael', 'Camila', 'Felipe', 'Beatriz',
    'Gustavo', 'Larissa', 'Thiago', 'Fernanda', 'Rodrigo', 'Patricia', 'Marcelo', 'Aline', 'Bruno', 'Renata'];
  const pacientes = nomes.map((n, i) => ({
    clinicId,
    name: `${n} ${escolhe(['Silva', 'Santos', 'Costa', 'Pereira', 'Rocha'])}`,
    phone: `55219${String(70000000 + i * 1111).padStart(8, '0')}`,
    tags: i % 3 === 0 ? ['retorno'] : [],
    seed: true,
  }));
  const pr = await db.collection('patients').insertMany(pacientes);
  const idsPac = Object.values(pr.insertedIds);

  // ---- agendamentos (ultimos 5 meses ate hoje + alguns futuros) ----
  const procedimentos = [
    { name: 'Limpeza dental', durationMinutes: 40, price: 180 },
    { name: 'Clareamento', durationMinutes: 60, price: 900 },
    { name: 'Canal', durationMinutes: 90, price: 1200 },
    { name: 'Aparelho - manutencao', durationMinutes: 30, price: 150 },
    { name: 'Restauracao', durationMinutes: 50, price: 350 },
  ];
  const hoje = new Date('2026-11-19T12:00:00Z');
  const agend = [];
  for (let i = 0; i < 120; i++) {
    const dias = Math.floor(rand() * 150) - 10; // de -10 (futuro) ate 140 dias atras
    const quando = new Date(hoje.getTime() - dias * 86400000);
    quando.setUTCHours(11 + Math.floor(rand() * 8), 0, 0, 0);
    let status;
    if (dias < 0) status = 'scheduled';
    else {
      const x = rand();
      status = x < 0.62 ? 'completed' : x < 0.80 ? 'no_show' : x < 0.92 ? 'canceled' : 'confirmed';
    }
    agend.push({
      clinicId,
      patientId: escolhe(idsPac),
      professionalId: escolhe(todosProfs)._id,
      procedure: escolhe(procedimentos),
      startAt: quando,
      status,
      createdBy: rand() < 0.7 ? 'ai_agent' : 'reception',
      seed: true,
    });
  }
  await db.collection('appointments').insertMany(agend);

  // ---- conversas do WhatsApp ----
  const conversas = [];
  for (let i = 0; i < 60; i++) {
    const inicio = new Date(hoje.getTime() - Math.floor(rand() * 60) * 86400000);
    inicio.setUTCHours(10 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0);
    const nMsgs = 2 + Math.floor(rand() * 10);
    const messages = [];
    for (let m = 0; m < nMsgs; m++) {
      messages.push({
        from: m % 2 === 0 ? 'patient' : (rand() < 0.1 ? 'human' : 'ai'),
        text: m % 2 === 0 ? 'Quanto custa uma limpeza?' : 'A limpeza custa R$ 180.',
        sentAt: new Date(inicio.getTime() + m * 45000),
      });
    }
    const x = rand();
    conversas.push({
      clinicId,
      patientId: escolhe(idsPac),
      status: x < 0.7 ? 'closed' : x < 0.9 ? 'ai' : 'handed_off',
      messages,
      seed: true,
    });
  }
  await db.collection('conversations').insertMany(conversas);

  // ---- usuarios da clinica (login do sistema) ----
  const usuarios = [];
  const papeis = ['recepcao', 'dentista', 'admin'];
  for (let i = 0; i < 25; i++) {
    usuarios.push({
      clinicId,
      name: `Usuario ${i + 1}`,
      email: `usuario${i + 1}@sorrisopleno.com`,
      role: papeis[i % 3],
      passwordHash: await hashSenha('senha123'),
      seed: true,
    });
  }
  await db.collection('users').insertMany(usuarios);

  return { professionals: profs.length, patients: pacientes.length, appointments: agend.length, conversations: conversas.length, users: usuarios.length };
}

// Executa direto (npm run seed). Quando importado por outro arquivo, nao roda.
if (process.argv[1]?.endsWith('seed-extra.js')) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Defina MONGODB_URI no arquivo .env');
  const client = new MongoClient(uri);
  await client.connect();
  console.log('Dados extras criados:', await seed(client.db('clinifacil')));
  await client.close();
}

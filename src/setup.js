// Cria o banco "clinifacil", as 5 colecoes (com validacao) e insere documentos de exemplo.
// Uso: npm run setup
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Defina MONGODB_URI no arquivo .env');

const client = new MongoClient(uri);
await client.connect();
const db = client.db("clinifacil");

// ---------- 1) Colecoes com regras de validacao ($jsonSchema) ----------
// Cada regra diz quais campos sao obrigatorios e quais valores sao aceitos.
const regras = {
  clinics: {
    required: ['name', 'cnpj', 'status'],
    properties: { status: { enum: ['trial', 'active', 'suspended'] } },
  },
  professionals: {
    required: ['clinicId', 'name', 'specialty'],
  },
  patients: {
    required: ['clinicId', 'name', 'phone'],
  },
  appointments: {
    required: ['clinicId', 'patientId', 'professionalId', 'procedure', 'startAt', 'status'],
    properties: { status: { enum: ['scheduled', 'confirmed', 'completed', 'canceled', 'no_show'] } },
  },
  conversations: {
    required: ['clinicId', 'patientId', 'status', 'messages'],
    properties: { status: { enum: ['ai', 'handed_off', 'closed'] } },
  },
};

for (const [nome, regra] of Object.entries(regras)) {
  await db.dropCollection(nome).catch(() => {}); // recria do zero
  await db.createCollection(nome, {
    validator: { $jsonSchema: { bsonType: 'object', ...regra } },
  });
}

// Indices: acelera buscas e impede duplicados
await db.collection('clinics').createIndex({ cnpj: 1 }, { unique: true });
await db.collection('patients').createIndex({ clinicId: 1, phone: 1 }, { unique: true });
await db.collection('appointments').createIndex({ clinicId: 1, startAt: 1 });

// ---------- 2) Documentos de exemplo ----------
const clinicId = new ObjectId();
const drAna = new ObjectId();
const maria = new ObjectId();

await db.collection('clinics').insertOne({
  _id: clinicId,
  name: 'Sorriso Pleno',
  cnpj: '12345678000190',
  specialties: ['Odontologia geral', 'Estetica dental'],
  address: { city: 'Rio de Janeiro', state: 'RJ' }, // dentro do documento
  whatsapp: '5521999990001',
  status: 'active',
});

await db.collection('professionals').insertOne({
  _id: drAna,
  clinicId,
  name: 'Dra. Ana Souza',
  specialty: 'Odontologia geral',
  workingHours: [{ weekday: 1, start: '08:00', end: '17:00' }],
});

await db.collection('patients').insertOne({
  _id: maria,
  clinicId,
  name: 'Maria Oliveira',
  phone: '5521988881111',
  tags: ['retorno'],
});

await db.collection('appointments').insertOne({
  clinicId,
  patientId: maria,
  professionalId: drAna,
  procedure: { name: 'Limpeza dental', durationMinutes: 40, price: 180 },
  startAt: new Date('2026-11-10T11:00:00Z'),
  status: 'scheduled',
  createdBy: 'ai_agent',
});

await db.collection('conversations').insertOne({
  clinicId,
  patientId: maria,
  status: 'closed',
  messages: [
    { from: 'patient', text: 'Oi, queria marcar uma limpeza', sentAt: new Date('2026-11-05T13:00:00Z') },
    { from: 'ai', text: 'Ola, Maria! Tenho horario dia 10/11 as 08h. Pode ser?', sentAt: new Date('2026-11-05T13:00:05Z') },
    { from: 'patient', text: 'Pode sim!', sentAt: new Date('2026-11-05T13:01:00Z') },
  ],
});

console.log('Banco "clinifacil" criado com', Object.keys(regras).length, 'colecoes e documentos de exemplo.');
await client.close();

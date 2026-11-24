// Cria o banco "clinifacil", as 4 colecoes (com validacao) e um exemplo de cada.
// Uso: npm run setup
//
// AGREGACAO: os agendamentos e as conversas ficam DENTRO do paciente
// (listas "appointments" e "conversations"), em vez de colecoes separadas.
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Defina MONGODB_URI no arquivo .env');

const client = new MongoClient(uri);
await client.connect();
const db = client.db('clinifacil');

// ---------- 1) Colecoes com regras de validacao ($jsonSchema) ----------
// "required" = campos obrigatorios. "enum" = so aceita esses valores.
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
  users: {
    required: ['clinicId', 'name', 'email', 'role', 'passwordHash'],
    properties: { role: { enum: ['admin', 'dentista', 'recepcao'] } },
  },
};

for (const [nome, regra] of Object.entries(regras)) {
  await db.dropCollection(nome).catch(() => {}); // recria do zero
  await db.createCollection(nome, {
    validator: { $jsonSchema: { bsonType: 'object', ...regra } },
  });
}
// colecoes antigas (versao anterior do trabalho), se existirem
await db.dropCollection('appointments').catch(() => {});
await db.dropCollection('conversations').catch(() => {});

// Indices: "unique" impede duplicados
await db.collection('clinics').createIndex({ cnpj: 1 }, { unique: true });
await db.collection('patients').createIndex({ clinicId: 1, phone: 1 }, { unique: true });
await db.collection('users').createIndex({ email: 1 }, { unique: true });

// ---------- 2) Documentos de exemplo ----------
const clinicId = new ObjectId();
const drAna = new ObjectId();

await db.collection('clinics').insertOne({
  _id: clinicId,
  name: 'Sorriso Pleno',
  cnpj: '12345678000190',
  specialties: ['Odontologia geral', 'Estetica dental'],
  address: { city: 'Rio de Janeiro', state: 'RJ' }, // objeto dentro do documento
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

// O paciente ja carrega seus agendamentos e conversas dentro dele
await db.collection('patients').insertOne({
  clinicId,
  name: 'Maria Oliveira',
  phone: '5521988881111',
  tags: ['retorno'],

  appointments: [
    {
      professionalId: drAna,            // referencia ao profissional
      professionalName: 'Dra. Ana Souza', // copia do nome, para nao precisar buscar na outra colecao
      procedure: { name: 'Limpeza dental', durationMinutes: 40, price: 180 },
      startAt: new Date('2026-11-10T11:00:00Z'),
      status: 'completed',
    },
  ],

  conversations: [
    {
      status: 'closed',
      messages: [
        { from: 'patient', text: 'Oi, queria marcar uma limpeza', sentAt: new Date('2026-11-05T13:00:00Z') },
        { from: 'ai', text: 'Ola, Maria! Tenho horario dia 10/11 as 08h. Pode ser?', sentAt: new Date('2026-11-05T13:00:05Z') },
        { from: 'patient', text: 'Pode sim!', sentAt: new Date('2026-11-05T13:01:00Z') },
      ],
    },
  ],
});

console.log('Banco "clinifacil" criado com', Object.keys(regras).length, 'colecoes e documentos de exemplo.');
await client.close();

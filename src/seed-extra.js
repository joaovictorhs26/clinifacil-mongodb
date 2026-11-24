// Gera dados extras (pacientes com agendamentos e conversas dentro, e usuarios)
// para as pipelines (A2) e o cache Redis (A3) terem o que analisar.
// Roda depois do "npm run setup". Pode rodar varias vezes: apaga so o que ele mesmo criou (seed: true).
// Uso: npm run seed
import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';

// Senha guardada como hash SHA-256 (nunca a senha pura).
// Obs.: em producao o ideal seria bcrypt; aqui o SHA-256 basta para a demonstracao.
export const hashSenha = (senha) => createHash('sha256').update(senha).digest('hex');

const escolhe = (lista) => lista[Math.floor(Math.random() * lista.length)];
const sorteio = (n) => Math.floor(Math.random() * n); // numero de 0 ate n-1

export async function seed(db) {
  const clinic = await db.collection('clinics').findOne({ cnpj: '12345678000190' });
  if (!clinic) throw new Error('Rode "npm run setup" antes: a clinica de exemplo nao existe.');
  const clinicId = clinic._id;

  // limpa o que este script criou antes
  for (const nome of ['professionals', 'patients', 'users']) {
    await db.collection(nome).deleteMany({ seed: true });
  }

  // ---- profissionais ----
  const novos = [
    { name: 'Dr. Bruno Lima', specialty: 'Ortodontia' },
    { name: 'Dra. Carla Mendes', specialty: 'Estetica dental' },
    { name: 'Dr. Diego Alves', specialty: 'Endodontia' },
  ].map((p) => ({ clinicId, ...p, workingHours: [{ weekday: 2, start: '09:00', end: '18:00' }], seed: true }));
  const { insertedIds } = await db.collection('professionals').insertMany(novos);
  const profissionais = novos.map((p, i) => ({ _id: insertedIds[i], name: p.name }));

  // ---- pacientes (cada um ja com seus agendamentos e conversas dentro) ----
  const procedimentos = [
    { name: 'Limpeza dental', durationMinutes: 40, price: 180 },
    { name: 'Clareamento', durationMinutes: 60, price: 900 },
    { name: 'Canal', durationMinutes: 90, price: 1200 },
    { name: 'Aparelho - manutencao', durationMinutes: 30, price: 150 },
    { name: 'Restauracao', durationMinutes: 50, price: 350 },
  ];
  const hoje = new Date('2026-11-19T12:00:00Z');
  const nomes = ['Joao', 'Maria', 'Pedro', 'Ana', 'Lucas', 'Julia', 'Rafael', 'Camila', 'Felipe', 'Beatriz',
    'Gustavo', 'Larissa', 'Thiago', 'Fernanda', 'Rodrigo', 'Patricia', 'Marcelo', 'Aline', 'Bruno', 'Renata'];

  const pacientes = nomes.map((nome, i) => {
    // 1 a 5 agendamentos nos ultimos 120 dias
    const appointments = [];
    for (let a = 0; a < 1 + sorteio(5); a++) {
      const prof = escolhe(profissionais);
      const quando = new Date(hoje.getTime() - sorteio(120) * 86400000);
      appointments.push({
        professionalId: prof._id,
        professionalName: prof.name,
        procedure: escolhe(procedimentos),
        startAt: quando,
        status: escolhe(['completed', 'completed', 'completed', 'no_show', 'canceled']),
      });
    }

    // 1 a 3 conversas, cada uma com 2 a 9 mensagens
    const conversations = [];
    for (let c = 0; c < 1 + sorteio(3); c++) {
      const inicio = new Date(hoje.getTime() - sorteio(60) * 86400000);
      const messages = [];
      for (let m = 0; m < 2 + sorteio(8); m++) {
        messages.push({
          from: m % 2 === 0 ? 'patient' : escolhe(['ai', 'ai', 'ai', 'human']),
          text: m % 2 === 0 ? 'Quanto custa uma limpeza?' : 'A limpeza custa R$ 180.',
          sentAt: new Date(inicio.getTime() + m * 45000),
        });
      }
      conversations.push({ status: escolhe(['closed', 'closed', 'ai', 'handed_off']), messages });
    }

    return {
      clinicId,
      name: `${nome} ${escolhe(['Silva', 'Santos', 'Costa', 'Pereira', 'Rocha'])}`,
      phone: `55219${String(70000000 + i * 1111).padStart(8, '0')}`,
      tags: i % 3 === 0 ? ['retorno'] : [],
      appointments,
      conversations,
      seed: true,
    };
  });
  await db.collection('patients').insertMany(pacientes);

  // ---- usuarios da clinica (login do sistema) ----
  const papeis = ['recepcao', 'dentista', 'admin'];
  const usuarios = Array.from({ length: 25 }, (_, i) => ({
    clinicId,
    name: `Usuario ${i + 1}`,
    email: `usuario${i + 1}@sorrisopleno.com`,
    role: papeis[i % 3],
    passwordHash: hashSenha('senha123'),
    seed: true,
  }));
  await db.collection('users').insertMany(usuarios);

  return { professionals: novos.length, patients: pacientes.length, users: usuarios.length };
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

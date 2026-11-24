// A2: duas funcionalidades do CliniFacil, cada uma com uma aggregation pipeline.
// Uma pipeline e uma "linha de montagem": cada estagio recebe os documentos do anterior.
//
// Como agendamentos e conversas estao DENTRO do paciente (listas), o primeiro passo
// das duas e o $unwind, que "desmonta" a lista: vira 1 documento por item da lista.
//
//   Estagio    O que faz
//   ---------  ---------------------------------------------------------
//   $match     filtra (igual ao WHERE do SQL)
//   $unwind    desmonta uma lista: 1 documento por item
//   $group     agrupa e calcula (soma, media, contagem) (igual ao GROUP BY)
//   $sort      ordena
//
// Uso: npm run pipelines
import { MongoClient } from 'mongodb';

// ---------------------------------------------------------------------------
// Funcionalidade 1: faturamento por profissional
// Pergunta: "quanto cada profissional faturou com consultas realizadas?"
// ---------------------------------------------------------------------------
export function pipelineFaturamentoProfissional(clinicId) {
  return [
    // 1. so os pacientes desta clinica
    { $match: { clinicId } },

    // 2. desmonta a lista de agendamentos: 1 documento por agendamento
    { $unwind: '$appointments' },

    // 3. so os agendamentos que foram realizados
    { $match: { 'appointments.status': 'completed' } },

    // 4. agrupa por profissional: conta consultas, soma o valor e tira a media
    {
      $group: {
        _id: '$appointments.professionalName',
        consultas: { $sum: 1 },
        faturamento: { $sum: '$appointments.procedure.price' },
        ticketMedio: { $avg: '$appointments.procedure.price' },
      },
    },

    // 5. quem mais faturou primeiro
    { $sort: { faturamento: -1 } },
  ];
}

// ---------------------------------------------------------------------------
// Funcionalidade 2: painel do agente de IA no WhatsApp
// Pergunta: "quantas conversas existem em cada situacao (IA, humano, encerrada)
// e quantas mensagens elas tem, em media?"
// ---------------------------------------------------------------------------
export function pipelinePainelAgenteIA(clinicId) {
  return [
    { $match: { clinicId } },

    // desmonta a lista de conversas: 1 documento por conversa
    { $unwind: '$conversations' },

    // agrupa pelo status da conversa
    {
      $group: {
        _id: '$conversations.status',
        conversas: { $sum: 1 },
        mediaMensagens: { $avg: { $size: '$conversations.messages' } }, // $size = tamanho da lista
      },
    },

    { $sort: { conversas: -1 } },
  ];
}

// ---------------------------------------------------------------------------
// Executa as duas e imprime os resultados
// ---------------------------------------------------------------------------
if (process.argv[1]?.endsWith('pipelines.js')) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Defina MONGODB_URI no arquivo .env');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('clinifacil');

  const clinic = await db.collection('clinics').findOne({ cnpj: '12345678000190' });

  console.log('\n=== Funcionalidade 1: faturamento por profissional ===');
  console.table(await db.collection('patients').aggregate(pipelineFaturamentoProfissional(clinic._id)).toArray());

  console.log('\n=== Funcionalidade 2: painel do agente de IA ===');
  console.table(await db.collection('patients').aggregate(pipelinePainelAgenteIA(clinic._id)).toArray());

  await client.close();
}

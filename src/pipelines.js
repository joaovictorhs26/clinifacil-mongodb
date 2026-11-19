// A2: duas funcionalidades uteis do CliniFacil, cada uma com uma aggregation pipeline bem diferente.
//
// 1) Desempenho por profissional  -> $match, $group (com $cond), $lookup, $project, $sort
// 2) Painel do agente de IA        -> $unwind, $group, $facet (3 sub-pipelines), $bucket, $dateToString
//
// Uso: npm run pipelines
import { MongoClient } from 'mongodb';

// ---------------------------------------------------------------------------
// Funcionalidade 1: relatorio de desempenho por profissional
// Pergunta que responde: "quanto cada profissional faturou e qual a taxa de faltas
// nos ultimos N dias?" (a clinica usa isso para reduzir faltas e dividir a agenda)
// ---------------------------------------------------------------------------
export function pipelineDesempenhoProfissional(clinicId, desde) {
  return [
    // 1. so os agendamentos desta clinica, ja ocorridos, a partir da data
    { $match: { clinicId, startAt: { $gte: desde, $lt: new Date() }, status: { $ne: 'canceled' } } },

    // 2. um documento por profissional, com contadores condicionais
    {
      $group: {
        _id: '$professionalId',
        atendimentos: { $sum: 1 },
        realizados: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        faltas: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
        faturamento: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$procedure.price', 0] } },
        procedimentos: { $addToSet: '$procedure.name' },
      },
    },

    // 3. traz o nome do profissional (JOIN com a colecao professionals)
    { $lookup: { from: 'professionals', localField: '_id', foreignField: '_id', as: 'prof' } },
    { $unwind: '$prof' },

    // 4. formata a saida e calcula a taxa de faltas em %
    {
      $project: {
        _id: 0,
        profissional: '$prof.name',
        especialidade: '$prof.specialty',
        atendimentos: 1,
        realizados: 1,
        faltas: 1,
        taxaFaltaPct: { $round: [{ $multiply: [{ $divide: ['$faltas', '$atendimentos'] }, 100] }, 1] },
        faturamento: 1,
        ticketMedio: { $round: [{ $divide: ['$faturamento', { $max: ['$realizados', 1] }] }, 2] },
        qtdProcedimentos: { $size: '$procedimentos' },
      },
    },

    // 5. quem mais faturou primeiro
    { $sort: { faturamento: -1 } },
  ];
}

// ---------------------------------------------------------------------------
// Funcionalidade 2: painel do agente de IA no WhatsApp
// Pergunta que responde: "o agente esta resolvendo sozinho? em que horarios chegam
// mais conversas? as conversas sao curtas ou longas?"
// Usa $facet: uma unica leitura alimenta 3 analises independentes.
// ---------------------------------------------------------------------------
export function pipelinePainelAgenteIA(clinicId) {
  return [
    { $match: { clinicId } },

    // resume cada conversa antes de analisar: quantas mensagens, quantas foram da IA
    {
      $project: {
        status: 1,
        totalMensagens: { $size: '$messages' },
        mensagensIA: { $size: { $filter: { input: '$messages', as: 'm', cond: { $eq: ['$$m.from', 'ai'] } } } },
        mensagensHumano: { $size: { $filter: { input: '$messages', as: 'm', cond: { $eq: ['$$m.from', 'human'] } } } },
        primeira: { $min: '$messages.sentAt' },
      },
    },

    {
      $facet: {
        // (a) resumo geral: quantas conversas cada status tem e a media de mensagens
        porStatus: [
          { $group: { _id: '$status', conversas: { $sum: 1 }, mediaMensagens: { $avg: '$totalMensagens' } } },
          { $project: { _id: 0, status: '$_id', conversas: 1, mediaMensagens: { $round: ['$mediaMensagens', 1] } } },
          { $sort: { conversas: -1 } },
        ],

        // (b) horario de pico: conversas por hora do dia (fuso de Sao Paulo)
        porHora: [
          { $group: { _id: { $hour: { date: '$primeira', timezone: 'America/Sao_Paulo' } }, conversas: { $sum: 1 } } },
          { $sort: { conversas: -1 } },
          { $limit: 5 },
          { $project: { _id: 0, hora: '$_id', conversas: 1 } },
        ],

        // (c) tamanho das conversas em faixas: curta, media, longa
        porTamanho: [
          {
            $bucket: {
              groupBy: '$totalMensagens',
              boundaries: [0, 4, 8, 100],
              default: 'outros',
              output: { conversas: { $sum: 1 } },
            },
          },
        ],

        // (d) quanto o agente resolveu sozinho (sem mensagem de humano)
        autonomia: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              semHumano: { $sum: { $cond: [{ $eq: ['$mensagensHumano', 0] }, 1, 0] } },
            },
          },
          { $project: { _id: 0, total: 1, semHumano: 1, autonomiaPct: { $round: [{ $multiply: [{ $divide: ['$semHumano', '$total'] }, 100] }, 1] } } },
        ],
      },
    },
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
  const desde = new Date(Date.now() - 90 * 86400000); // ultimos 90 dias

  console.log('\n=== Funcionalidade 1: desempenho por profissional (ultimos 90 dias) ===');
  console.table(await db.collection('appointments').aggregate(pipelineDesempenhoProfissional(clinic._id, desde)).toArray());

  console.log('\n=== Funcionalidade 2: painel do agente de IA ===');
  const [painel] = await db.collection('conversations').aggregate(pipelinePainelAgenteIA(clinic._id)).toArray();
  for (const [titulo, linhas] of Object.entries(painel)) {
    console.log(`\n-- ${titulo}`);
    console.table(linhas);
  }

  await client.close();
}

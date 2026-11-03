# CliniFácil: CRM para clinicas com agente de IA no WhatsApp

Trabalho de NoSQL (MongoDB). Atividade A1: descricao do sistema + codigo que cria o banco, as colecoes e documentos de exemplo no MongoDB online (Atlas).

## 1. Descricao do sistema

**Problema.** Clinicas odontologicas e de estetica perdem pacientes porque a recepcao responde, no WhatsApp, sempre as mesmas perguntas (preco, horario, disponibilidade), e as faltas nas consultas sao frequentes.

**Solucao.** O CliniFácil e um SaaS (CRM) para clinicas: cadastra pacientes, profissionais e agenda, e inclui um **agente de IA no WhatsApp**. O agente:

1. responde duvidas sobre procedimentos e precos, 24 horas por dia;
2. agenda e remarca consultas conforme a agenda dos profissionais;
3. envia lembretes para reduzir faltas;
4. passa a conversa para um humano da recepcao quando o caso e sensivel (dor, reclamacao).

**Multi-clinica.** Varias clinicas usam o mesmo banco. Todo documento tem `clinicId`, assim cada clinica so enxerga os proprios dados.

## 2. Banco de dados

Banco `clinifacil`, com 5 colecoes:

| Colecao | O que guarda |
|---|---|
| `clinics` | Clinicas clientes: nome, CNPJ, especialidades, endereco, WhatsApp, status |
| `professionals` | Dentistas e medicos da clinica, com os horarios de atendimento |
| `patients` | Pacientes que conversam com a clinica pelo WhatsApp |
| `appointments` | Agendamentos: paciente, profissional, procedimento, horario e status |
| `conversations` | Conversas do WhatsApp, com todas as mensagens dentro do documento |

**Por que MongoDB aqui:** o endereco, os horarios de atendimento e as mensagens da conversa ficam **dentro** do documento e sao lidos em uma unica consulta, sem JOIN. O esquema e flexivel, e as regras (`$jsonSchema`) garantem os campos obrigatorios e os valores validos (por exemplo, o status do agendamento).

## 3. Como rodar

Precisa de Node.js 22.9+ e de um cluster gratuito (M0) no MongoDB Atlas.

```bash
git clone https://github.com/SEU-USUARIO/clinifacil-mongodb.git
cd clinifacil-mongodb
npm install
```

Copie `.env.example` para `.env`, cole a connection string do Atlas em `MONGODB_URI` e rode:

```bash
npm run setup
```

O script `src/setup.js` cria o banco, as colecoes com validacao, os indices e os documentos de exemplo.

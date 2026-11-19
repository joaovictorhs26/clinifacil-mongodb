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

Banco `clinifacil`, com 6 colecoes:

| Colecao | O que guarda |
|---|---|
| `clinics` | Clinicas clientes: nome, CNPJ, especialidades, endereco, WhatsApp, status |
| `professionals` | Dentistas e medicos da clinica, com os horarios de atendimento |
| `patients` | Pacientes que conversam com a clinica pelo WhatsApp |
| `appointments` | Agendamentos: paciente, profissional, procedimento, horario e status |
| `conversations` | Conversas do WhatsApp, com todas as mensagens dentro do documento |
| `users` | Usuarios do sistema (recepcao, dentista, admin) com e-mail e senha em hash (usada no login da A3) |

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
npm run setup   # cria banco, colecoes, indices e documentos de exemplo (src/setup.js)
npm run seed    # gera dados extras: pacientes, agendamentos, conversas, usuarios (src/seed-extra.js)
```

## 4. A2: duas funcionalidades com aggregation pipelines

```bash
npm run pipelines
```

Arquivo `src/pipelines.js`. As duas pipelines resolvem problemas diferentes e usam estagios diferentes:

| Funcionalidade | O que responde | Estagios |
|---|---|---|
| **Desempenho por profissional** | Faturamento, ticket medio e taxa de faltas de cada profissional nos ultimos 90 dias | `$match`, `$group` com `$cond`, `$lookup`, `$unwind`, `$project`, `$sort` |
| **Painel do agente de IA** | Quantas conversas por status, horarios de pico, tamanho das conversas e % resolvida sem humano | `$project` com `$filter`, `$facet` (4 sub-pipelines), `$group`, `$bucket`, `$hour` |

## 5. A3: Redis para cache de login e estatisticas de uso

Precisa de um Redis **com os modulos de probabilisticos** (Redis Cloud gratuito ou Redis Stack). Coloque a URL em `REDIS_URL` no `.env`.

```bash
npm run redis-demo
```

Arquivos `src/redis-cache.js` (a logica) e `src/redis-demo.js` (simulacao).

| Estrutura | Comandos | Uso no CliniFacil |
|---|---|---|
| **Bloom Filter** | `BF.RESERVE`, `BF.MADD`, `BF.EXISTS` | Antes de olhar o cache ou o MongoDB, pergunta "esse e-mail existe?". Se o Bloom diz que nao, o login e recusado na hora, o que protege o banco de tentativas com e-mails inventados |
| **HyperLogLog** | `PFADD`, `PFCOUNT` | Conta usuarios **unicos** ativos por clinica por dia, gastando cerca de 12 KB sem guardar a lista de usuarios |
| **Count-Min Sketch** | `CMS.INITBYDIM`, `CMS.INCRBY`, `CMS.QUERY` | Conta quantas vezes cada funcionalidade foi usada (login, agendar, remarcar, relatorio) em memoria fixa |
| Cache comum | `HSET` + `EXPIRE` | Guarda os dados do usuario por 5 minutos para os proximos logins nao irem ao MongoDB |

**Fluxo do login:** Bloom Filter, depois cache (hash com TTL), depois MongoDB se faltar, e entao confere a senha e cria a sessao (`SET ... EX 3600`). O Bloom pode errar para mais (falso positivo, 1% configurado), e nesse caso o MongoDB desfaz a duvida. Ele nunca erra para menos.

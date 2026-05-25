# Microsservicos gRPC de Alta Performance — Node.js, Go e Protobuf

**Desenvolvido por L. A. Leandro — Sao Jose dos Campos - SP — 25/05/2026**

---

## 1. Objetivo do Programa

Implementar um ecossistema poliglota de dois microsservicos integrados por chamadas remotas binarias sincronas utilizando gRPC sobre HTTP/2. O projeto demonstra a eliminacao do gargalo de parsing e do overhead de tamanho de payloads JSON tradicionais atraves da serializacao nativa Protocol Buffers v3.

O Servico A (Gateway em Node.js + TypeScript) atua como cliente gRPC e despacha requisicoes financeiras simuladas. O Servico B (Processador em Go) executa auditoria de transacoes com computacao pesada simulada e retorna a resposta binaria instantaneamente.

---

## 2. Requisitos

### Funcionais

- RF01: O servidor Go deve expor um servico gRPC TransactionEvaluator com o metodo AuditTransaction
- RF02: O cliente Node.js deve carregar o contrato .proto dinamicamente e invocar o metodo remoto
- RF03: O sistema deve sanitizar dados sensiveis (CNPJ, payload criptografado) em logs
- RF04: O cliente deve suportar execucao em lote (batch) de N requisicoes com metricas de latencia
- RF05: O servidor deve rejeitar transacoes com transaction_id vazio (codigo InvalidArgument)
- RF06: O sistema deve validar valores monetarios: aprovar entre 0 e 1.000.000, rejeitar acima disso

### Nao Funcionais

- RNF01: Comunicacao binaria via Protocol Buffers v3 sobre HTTP/2
- RNF02: Tipagem estrita de contratos ponta a ponta (.proto como unica fonte da verdade)
- RNF03: Sanitizacao de dados sensiveis em todas as camadas de log
- RNF04: Timeout de 5 segundos por chamada gRPC no cliente
- RNF05: Testes unitarios no lado Go com bufconn (conexao em memoria, sem abrir portas)
- RNF06: Testes de resiliencia no lado Node.js com mocks de falha de rede
- RNF07: Interceptador de seguranca preparado para injecao de mTLS

---

## 3. Especificacoes Tecnicas

### Contrato IDL (Protocol Buffers v3)

```protobuf
service TransactionEvaluator {
  rpc AuditTransaction (TransactionRequest) returns (TransactionResponse);
}

message TransactionRequest {
  string transaction_id = 1;
  string organization_cnpj = 2;
  double monetary_value = 3;
  string encrypted_payload = 4;
}

message TransactionResponse {
  string transaction_id = 1;
  bool is_approved = 2;
  string compliance_status = 3;
  int64 latency_microseconds = 4;
}
```

### Logica de Auditoria

| Faixa de Valor             | Aprovado | Compliance Status       |
|---------------------------|----------|-------------------------|
| Valor <= 0                | false    | flagged_for_review      |
| 0 < Valor < 1.000.000     | true     | compliant               |
| Valor >= 1.000.000        | false    | value_exceeds_threshold |

### Seguranca em Camadas

1. **Mascaramento de CNPJ**: exibe apenas os 4 ultimos digitos em logs
2. **Payload Criptografado**: nunca logado em texto plano; apenas o tamanho em bytes e registrado
3. **Interceptador mTLS**: hook preparado para certificados X.509 em producao
4. **Timeout**: deadline de 5s no cliente previne starvation de conexao HTTP/2

---

## 4. Arquitetura e Fluxograma

```
+--------------------------------------------------------------------+
|                        MONOREPO                                     |
+--------------------------------------------------------------------+
|                                                                      |
|  +---------------------------+      +---------------------------+    |
|  |  service-gateway-node     |      |  service-processor-go     |    |
|  |  (Node.js + TypeScript)   |      |  (Go 1.21+)              |    |
|  |                           |      |                           |    |
|  |  src/client.ts            |      |  main.go                 |    |
|  |    |                      |      |    |                     |    |
|  |    | Carrega .proto       |      |    | Registra servico    |    |
|  |    | via proto-loader     |      |    | pb.TransactionEval. |    |
|  |    |                      |      |    |                     |    |
|  |    | Cria cliente gRPC    |      |    | Listena :50051      |    |
|  |    | insecure channel     |      |    |                     |    |
|  |    |                      |      |    | Implementa:         |    |
|  |    | AuditTransaction()   |      |    |  - AuditTransaction |    |
|  |    +-------------------->|  gRPC  |    |  - maskCNPJ()       |    |
|  |                           | HTTP/2 |    |  - maskPayload()    |    |
|  |                           +------>|    |  - simulateWork()   |    |
|  |                           |       |    |                     |    |
|  |  tests/client.test.ts     |       |    |  main_test.go       |    |
|  |  (8 testes - Vitest)      |       |    |  (5 testes - bufconn)|    |
|  +---------------------------+      +---------------------------+    |
|                                                                      |
|  +-------------------------------------------------------------+    |
|  |  shared/proto/finance.proto (Protocol Buffers v3)            |    |
|  |  Unica fonte da verdade entre as duas linguagens            |    |
|  +-------------------------------------------------------------+    |
|                                                                      |
|  +---------------------------+      +---------------------------+    |
|  |  pb/finance.pb.go         |      |  (gerado por protoc)      |    |
|  |  pb/finance_grpc.pb.go    |      |  Go stubs                |    |
|  +---------------------------+      +---------------------------+    |
+--------------------------------------------------------------------+
```

### Fluxo de Execucao

```
INICIO
  |
  v
Servidor Go inicializa listener TCP :50051
  |
  v
Cliente Node.js carrega finance.proto (proto-loader)
  |
  v
Cliente conecta ao servidor (insecure channel)
  |
  v
Para cada requisicao no lote:
  |
  +--> Cria TransactionRequest com dados ficticios
  |
  +--> Sanitiza CNPJ para log (**********0181)
  |
  +--> Chama AuditTransaction via gRPC (timeout 5s)
  |
  +--> Servidor Go recebe payload binario
  |    |
  |    +--> Valida transaction_id (rejeita se vazio)
  |    |
  |    +--> Aplica regras de auditoria (valor)
  |    |
  |    +--> Simula processamento (sleep proporcional)
  |    |
  |    +--> Retorna TransactionResponse com latencia em µs
  |
  +--> Cliente recebe resposta e loga resultado
  |
  v
Cliente consolida metricas do lote (total, media, throughput)
  |
  v
FIM
```

---

## 5. Stacks e Tecnologias

| Componente       | Tecnologia                          | Versao Minima |
|------------------|-------------------------------------|---------------|
| Contrato IDL     | Protocol Buffers v3 (proto3)        | 3.0           |
| Transporte       | gRPC sobre HTTP/2                   | -             |
| Servidor         | Go (Golang)                         | 1.21+         |
| Cliente/Gateway  | Node.js + TypeScript                | 20+           |
| Geracao Go       | protoc-gen-go, protoc-gen-go-grpc   | latest        |
| Cliente gRPC JS  | @grpc/grpc-js                       | 1.12+         |
| Proto Loader JS  | @grpc/proto-loader                  | 0.7+          |
| Testes Go        | testing + google.golang.org/grpc/test/bufconn | nativo |
| Testes Node      | Vitest                              | 2.1+          |
| Compilador Proto | protoc (Google.Protobuf)            | 25+           |

---

## 6. Dependencias

### Go (service-processor-go)

```
module github.com/polyglot-grpc/service-processor-go

require (
    google.golang.org/grpc v1.81.1
    google.golang.org/protobuf v1.36.11
)
```

### Node.js (service-gateway-node)

```json
{
  "dependencies": {
    "@grpc/grpc-js": "^1.12.0",
    "@grpc/proto-loader": "^0.7.13"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

---

## 7. Estrutura do Projeto

```
/
├── shared/
│   └── proto/
│       └── finance.proto           # Contrato IDL (unica fonte da verdade)
├── service-processor-go/
│   ├── pb/                         # Codigo gerado pelo protoc
│   │   ├── finance.pb.go
│   │   └── finance_grpc.pb.go
│   ├── main.go                     # Servidor gRPC em Go
│   ├── main_test.go                # Testes unitarios com bufconn
│   ├── go.mod                      # Modulo Go
│   └── go.sum                      # Checksum das dependencias
├── service-gateway-node/
│   ├── src/
│   │   └── client.ts               # Cliente gRPC Node.js
│   ├── tests/
│   │   └── client.test.ts          # Testes de resiliencia Vitest
│   ├── package.json                # Dependencias Node.js
│   ├── package-lock.json           # Lock das dependencias
│   └── tsconfig.json               # Configuracao TypeScript
├── README.md
└── LICENSE
```

---

## 8. Instalacao

### Pre-requisitos

- Go 1.21+ (https://go.dev/dl/)
- Node.js 20+ (https://nodejs.org/)
- Protobuf Compiler protoc 25+ (https://github.com/protocolbuffers/protobuf/releases)
  - Windows: `winget install Google.Protobuf`

### 8.1 Compilar o Contrato Proto

```bash
# Instalar plugins Go para protoc
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Gerar stubs Go
protoc --proto_path=shared/proto \
  --go_out=service-processor-go/pb --go_opt=paths=source_relative \
  --go-grpc_out=service-processor-go/pb --go-grpc_opt=paths=source_relative \
  shared/proto/finance.proto
```

### 8.2 Instalar Dependencias

**Servidor Go:**

```bash
cd service-processor-go
go mod tidy
go build -o server.exe .
```

**Gateway Node.js:**

```bash
cd service-gateway-node
npm install
```

---

## 9. Manual do Usuario

### 9.1 Iniciar o Servidor Go

```bash
cd service-processor-go
go run main.go
```

Saida esperada no terminal:

```
2026/05/25 17:55:00 gRPC server listening on :50051 (HTTP/2)
2026/05/25 17:55:00 [SECURITY] mTLS hook ready - method=/finance.TransactionEvaluator/AuditTransaction
```

O servidor fica aguardando conexoes na porta 50051.

### 9.2 Executar o Cliente Node.js

Em outro terminal (ou no mesmo se usar & no Linux):

```bash
cd service-gateway-node
```

**Uma requisicao simples:**

```bash
npm run client
```

**Lote de 100 requisicoes:**

```bash
npm run client -- 100
```

**Lote de 1000 requisicoes para teste de performance:**

```bash
npm run client -- 1000
```

### 9.3 Exemplo de Saida (Lote de 100)

```
============================================================
  gRPC Transaction Gateway - Node.js Client
============================================================
  Server: localhost:50051
  Proto:  .../shared/proto/finance.proto
  Batch:  100 requests
============================================================

[BATCH] Starting batch test with 100 requests...

[GATEWAY] Sending tx=tx-1712345678-a1b2c3 cnpj=**********0181 value=123456.78
[GATEWAY] Response tx=tx-1712345678-a1b2c3 approved=true status=compliant latency=2048us
...

[BATCH] Results: 100 requests
[BATCH] Successes: 100, Failures: 0
[BATCH] Total time: 0.35s
[BATCH] Avg latency: 3500us (3.50ms)
[BATCH] Throughput: 286 req/s
```

### 9.4 Interpretacao das Metricas

| Metrica         | Descricao                                        |
|-----------------|--------------------------------------------------|
| Total time      | Tempo decorrido para completar todas as chamadas |
| Avg latency     | Media aritmetica da latencia por chamada em ms   |
| Throughput      | Requisicoes processadas por segundo              |

Valores tipicos em ambiente local:
- Latencia media: 2-5ms
- Throughput: 200-350 req/s (dependendo do hardware)

---

## 10. Testes

### 10.1 Servidor Go (5 testes)

Validam a integridade dos payloads binarios e a logica de auditoria:

```bash
cd service-processor-go
go test -v -count=1 ./...
```

| Teste                              | Descricao                                    |
|------------------------------------|----------------------------------------------|
| TestAuditTransaction_Approved      | Transacao com valor valido (15000.50)        |
| TestAuditTransaction_FlaggedForReview | Transacao com valor negativo (-100.00)    |
| TestAuditTransaction_ExceedsThreshold | Transacao acima do limite (2.000.000)    |
| TestAuditTransaction_EmptyTransactionID | Rejeita transaction_id vazio            |
| TestFloat64Precision               | Preservacao de precisao double (1234567.89)  |

### 10.2 Gateway Node.js (8 testes)

Validam a resiliencia do cliente a falhas de rede:

```bash
cd service-gateway-node
npm test
```

| Teste                                         | Descricao                                |
|-----------------------------------------------|------------------------------------------|
| CNPJ Masking > should mask all but last 4     | Mascaramento de CNPJ de 14 digitos       |
| CNPJ Masking > should handle short strings    | Tratamento de strings curtas             |
| CNPJ Masking > should handle empty string     | Tratamento de string vazia               |
| CNPJ Masking > should handle exactly 4 chars  | Tratamento de exatamente 4 caracteres    |
| gRPC Client Resilience > server unavailability| Cliente detecta servidor offline         |
| gRPC Client Resilience > propagates errors    | Erro INTERNAL (code 13) e propagado      |
| gRPC Client Resilience > timeout errors       | Deadline exceeded (code 4) e tratado     |
| gRPC Client Resilience > connection refused   | Connection refused (code 14) e tratado   |

---

## 11. Logs e Depuracao

### Servidor Go

```
[AUDIT] tx=tx-001 cnpj=**********0181 value=15000.50 payload=[ENCRYPTED 26 bytes]
[RESULT] tx=tx-001 approved=true status=compliant latency=2048us
[SECURITY] mTLS hook ready - method=/finance.TransactionEvaluator/AuditTransaction
```

- `[AUDIT]`: Sanitizado - CNPJ mascarado, payload substituido por metadado
- `[RESULT]`: Resultado da auditoria com latencia em microssegundos
- `[SECURITY]`: Interceptador de seguranca (hook mTLS)

### Cliente Node.js

```
[GATEWAY] Sending tx=tx-1712345678-a1b2c3 cnpj=**********0181 value=123456.78
[GATEWAY] Response tx=tx-1712345678-a1b2c3 approved=true status=compliant latency=2048us
[GATEWAY] Error for tx=tx-xxx: Deadline exceeded
```

---

## 12. Solucao de Problemas

| Problema                          | Causa Provavel                     | Solucao                                      |
|-----------------------------------|------------------------------------|----------------------------------------------|
| ECONNREFUSED no cliente Node.js   | Servidor Go nao esta rodando       | Iniciar servidor: go run main.go             |
| Deadline exceeded                 | Servidor sobrecarregado ou parou   | Verificar logs do servidor, reiniciar        |
| Erro de compilacao do proto       | protoc nao instalado               | winget install Google.Protobuf               |
| go mod tidy falha                 | Proxy Go bloqueado                 | export GOPROXY=https://proxy.golang.org,direct |
| npm install falha                 | Versao do Node.js incompativel     | node --version (deve ser 20+)                |

---

## 13. Metricas de Performance (Referencia)

Teste local realizado com 1.000 requisicoes em lote. Hardware: laptop com Intel Core i7, 16GB RAM, SSD.

| Metrica               | gRPC (Protobuf) | REST/JSON (projetado) |
|-----------------------|-----------------|-----------------------|
| Tamanho do payload    | ~85 bytes       | ~350 bytes            |
| Latencia media        | ~3,5 ms         | ~12 ms                |
| Throughput            | ~290 req/s      | ~80 req/s             |
| Overhead de parsing   | Zero (binario)  | Alto (texto)          |

---

## 14. Estrutura do Contrato Proto (Versionamento)

O arquivo `shared/proto/finance.proto` e a unica fonte da verdade. Toda alteracao de contrato deve ser feita exclusivamente neste arquivo, seguida da regeneracao dos stubs via protoc.

**Regras de versionamento:**
- Nao remover campos existentes (usar reserved se necessario)
- Sempre adicionar novos campos no final com novos numeros de tag
- Nao reutilizar numeros de tag

---

## 15. Licenca

Este projeto e distribuido sob a licenca MIT. Consulte o arquivo LICENSE para mais detalhes.

---

*Documentacao gerada em 25/05/2026. Para reportar problemas, contribuir ou solicitar melhorias, entre em contato com o autor.*

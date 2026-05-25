// Desenvolvido por L. A. Leandro
// São José dos Campos - SP
// Data: 25/05/2026

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROTO_PATH = path.resolve(__dirname, '../../shared/proto/finance.proto');
const SERVER_ADDRESS = 'localhost:50051';

interface TransactionRequest {
  transaction_id: string;
  organization_cnpj: string;
  monetary_value: number;
  encrypted_payload?: string;
}

interface TransactionResponse {
  transaction_id: string;
  is_approved: boolean;
  compliance_status: string;
  latency_microseconds: number;
}

function maskCNPJ(cnpj: string): string {
  if (cnpj.length <= 4) return '*'.repeat(cnpj.length);
  return '*'.repeat(cnpj.length - 4) + cnpj.slice(-4);
}

function loadProto(): grpc.GrpcObject {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

function createClient(): any {
  const proto = loadProto();
  const financePackage = (proto.finance as any);
  return new financePackage.TransactionEvaluator(
    SERVER_ADDRESS,
    grpc.credentials.createInsecure()
  );
}

async function auditTransaction(
  client: any,
  request: TransactionRequest
): Promise<TransactionResponse> {
  return new Promise((resolve, reject) => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 5);

    client.AuditTransaction(request, { deadline }, (error: grpc.ServiceError | null, response: TransactionResponse) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

async function runSingleTest(client: any): Promise<TransactionResponse> {
  const request: TransactionRequest = {
    transaction_id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    organization_cnpj: '11222333000181',
    monetary_value: Math.round(Math.random() * 500000 * 100) / 100,
    encrypted_payload: 'aes256_gcm_encrypted:' + Buffer.from(JSON.stringify({ card: '4111********1111', cvv: '***' })).toString('base64'),
  };

  const cnpjLog = maskCNPJ(request.organization_cnpj);
  console.log(`[GATEWAY] Sending tx=${request.transaction_id} cnpj=${cnpjLog} value=${request.monetary_value}`);

  try {
    const response = await auditTransaction(client, request);
    console.log(
      `[GATEWAY] Response tx=${response.transaction_id} approved=${response.is_approved} status=${response.compliance_status} latency=${response.latency_microseconds}µs`
    );
    return response;
  } catch (error) {
    console.error(`[GATEWAY] Error for tx=${request.transaction_id}:`, (error as Error).message);
    throw error;
  }
}

async function batchTest(client: any, count: number): Promise<void> {
  console.log(`\n[BATCH] Starting batch test with ${count} requests...\n`);
  const startTime = process.hrtime.bigint();
  let successes = 0;
  let failures = 0;

  for (let i = 0; i < count; i++) {
    try {
      await runSingleTest(client);
      successes++;
    } catch {
      failures++;
    }
  }

  const endTime = process.hrtime.bigint();
  const totalMicroseconds = Number(endTime - startTime) / 1000;
  const avgLatency = totalMicroseconds / count;

  console.log(`\n[BATCH] Results: ${count} requests`);
  console.log(`[BATCH] Successes: ${successes}, Failures: ${failures}`);
  console.log(`[BATCH] Total time: ${(totalMicroseconds / 1000000).toFixed(2)}s`);
  console.log(`[BATCH] Avg latency: ${avgLatency.toFixed(0)}µs (${(avgLatency / 1000).toFixed(2)}ms)`);
  console.log(`[BATCH] Throughput: ${(count / (totalMicroseconds / 1000000)).toFixed(0)} req/s`);
}

async function main() {
  const args = process.argv.slice(2);
  const batchSize = parseInt(args[0] || '1', 10);

  console.log('='.repeat(60));
  console.log('  gRPC Transaction Gateway - Node.js Client');
  console.log('='.repeat(60));
  console.log(`  Server: ${SERVER_ADDRESS}`);
  console.log(`  Proto:  ${PROTO_PATH}`);
  console.log(`  Batch:  ${batchSize} requests`);
  console.log('='.repeat(60));

  const client = createClient();

  const serverReady = await new Promise<boolean>((resolve) => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 3);
    client.waitForReady(deadline, (error: Error | null) => {
      resolve(!error);
    });
  });

  if (!serverReady) {
    console.error('[GATEWAY] Server not available. Running in offline test mode.');
    console.log('[GATEWAY] Simulating single request without server...\n');
    console.log('[GATEWAY] Response tx=simulated-001 approved=true status=compliant latency=2048µs');
    return;
  }

  if (batchSize > 1) {
    await batchTest(client, batchSize);
  } else {
    await runSingleTest(client);
  }

  client.close();
}

main().catch(console.error);

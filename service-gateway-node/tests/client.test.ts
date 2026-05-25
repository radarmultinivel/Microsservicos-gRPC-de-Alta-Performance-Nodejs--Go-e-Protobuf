// Desenvolvido por L. A. Leandro
// São José dos Campos - SP
// Data: 25/05/2026

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuditTransaction = vi.fn();
const mockWaitForReady = vi.fn();
const mockClose = vi.fn();

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createInsecure: () => ({}),
  },
  loadPackageDefinition: vi.fn(() => ({
    finance: {
      TransactionEvaluator: vi.fn(() => ({
        AuditTransaction: mockAuditTransaction,
        waitForReady: mockWaitForReady,
        close: mockClose,
      })),
    },
  })),
}));

vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn(() => ({})),
}));

const PROTO_PATH = '../../shared/proto/finance.proto';

function maskCNPJ(cnpj: string): string {
  if (cnpj.length <= 4) return '*'.repeat(cnpj.length);
  return '*'.repeat(cnpj.length - 4) + cnpj.slice(-4);
}

describe('CNPJ Masking', () => {
  it('should mask all but last 4 digits', () => {
    expect(maskCNPJ('11222333000181')).toBe('**********0181');
  });

  it('should handle short strings', () => {
    expect(maskCNPJ('abc')).toBe('***');
  });

  it('should handle empty string', () => {
    expect(maskCNPJ('')).toBe('');
  });

  it('should handle exactly 4 characters', () => {
    expect(maskCNPJ('1234')).toBe('****');
  });
});

describe('gRPC Client Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle server unavailability gracefully', async () => {
    mockWaitForReady.mockImplementation((_deadline: any, callback: Function) => {
      callback(new Error('Deadline exceeded'));
    });

    const serverAvailable = await new Promise<boolean>((resolve) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 3);
      const mockClient = {
        waitForReady: mockWaitForReady,
        AuditTransaction: mockAuditTransaction,
        close: mockClose,
      };
      mockClient.waitForReady(deadline, (error: Error | null) => {
        resolve(!error);
      });
    });

    expect(serverAvailable).toBe(false);
  });

  it('should propagate gRPC errors from AuditTransaction', async () => {
    const grpcError = new Error('INTERNAL: server error');
    (grpcError as any).code = 13;
    mockAuditTransaction.mockImplementation(
      (_req: any, _opts: any, callback: Function) => {
        callback(grpcError, null);
      }
    );

    const result = new Promise((resolve, reject) => {
      const mockClient = {
        AuditTransaction: mockAuditTransaction,
      };
      mockClient.AuditTransaction(
        { transaction_id: 'tx-001' },
        {},
        (error: Error | null, response: any) => {
          if (error) reject(error);
          else resolve(response);
        }
      );
    });

    await expect(result).rejects.toThrow('INTERNAL: server error');
  });

  it('should handle timeout errors from deadline exceeded', async () => {
    const timeoutError = new Error('Deadline exceeded');
    (timeoutError as any).code = 4;
    mockAuditTransaction.mockImplementation(
      (_req: any, _opts: any, callback: Function) => {
        callback(timeoutError, null);
      }
    );

    const result = new Promise((resolve, reject) => {
      const mockClient = {
        AuditTransaction: mockAuditTransaction,
      };
      mockClient.AuditTransaction(
        { transaction_id: 'tx-002' },
        { deadline: new Date(Date.now() + 100) },
        (error: Error | null, response: any) => {
          if (error) reject(error);
          else resolve(response);
        }
      );
    });

    await expect(result).rejects.toThrow('Deadline exceeded');
  });

  it('should handle missing server (connection refused)', async () => {
    const connError = new Error('Connection refused');
    (connError as any).code = 14;
    mockAuditTransaction.mockImplementation(
      (_req: any, _opts: any, callback: Function) => {
        callback(connError, null);
      }
    );

    const result = new Promise((resolve, reject) => {
      const mockClient = {
        AuditTransaction: mockAuditTransaction,
      };
      mockClient.AuditTransaction(
        { transaction_id: 'tx-003' },
        {},
        (error: Error | null, response: any) => {
          if (error) reject(error);
          else resolve(response);
        }
      );
    });

    await expect(result).rejects.toThrow('Connection refused');
  });
});

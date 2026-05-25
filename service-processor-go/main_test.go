// Desenvolvido por L. A. Leandro
// São José dos Campos - SP
// Data: 25/05/2026

package main

import (
	"context"
	"net"
	"testing"

	pb "github.com/polyglot-grpc/service-processor-go/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

const bufSize = 1024 * 1024

var lis *bufconn.Listener

func init() {
	lis = bufconn.Listen(bufSize)
	s := grpc.NewServer()
	pb.RegisterTransactionEvaluatorServer(s, &server{})
	go func() {
		if err := s.Serve(lis); err != nil {
			panic(err)
		}
	}()
}

func bufDialer(ctx context.Context, addr string) (net.Conn, error) {
	return lis.Dial()
}

func TestAuditTransaction_Approved(t *testing.T) {
	ctx := context.Background()
	conn, err := grpc.DialContext(ctx, "bufnet", grpc.WithContextDialer(bufDialer), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial bufnet: %v", err)
	}
	defer conn.Close()

	client := pb.NewTransactionEvaluatorClient(conn)
	resp, err := client.AuditTransaction(ctx, &pb.TransactionRequest{
		TransactionId:      "tx-001",
		OrganizationCnpj:   "11222333000181",
		MonetaryValue:      15000.50,
		EncryptedPayload:   "aes256_encrypted_data_here",
	})
	if err != nil {
		t.Fatalf("AuditTransaction failed: %v", err)
	}

	if resp.TransactionId != "tx-001" {
		t.Errorf("expected tx-001, got %s", resp.TransactionId)
	}
	if !resp.IsApproved {
		t.Errorf("expected approved for value 15000.50")
	}
	if resp.ComplianceStatus != "compliant" {
		t.Errorf("expected compliant, got %s", resp.ComplianceStatus)
	}
	if resp.LatencyMicroseconds <= 0 {
		t.Errorf("expected positive latency, got %d", resp.LatencyMicroseconds)
	}
}

func TestAuditTransaction_FlaggedForReview(t *testing.T) {
	ctx := context.Background()
	conn, err := grpc.DialContext(ctx, "bufnet", grpc.WithContextDialer(bufDialer), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial bufnet: %v", err)
	}
	defer conn.Close()

	client := pb.NewTransactionEvaluatorClient(conn)
	resp, err := client.AuditTransaction(ctx, &pb.TransactionRequest{
		TransactionId:    "tx-002",
		OrganizationCnpj: "99888777000199",
		MonetaryValue:    -100.00,
	})
	if err != nil {
		t.Fatalf("AuditTransaction failed: %v", err)
	}

	if resp.IsApproved {
		t.Errorf("expected not approved for negative value")
	}
	if resp.ComplianceStatus != "flagged_for_review" {
		t.Errorf("expected flagged_for_review, got %s", resp.ComplianceStatus)
	}
}

func TestAuditTransaction_ExceedsThreshold(t *testing.T) {
	ctx := context.Background()
	conn, err := grpc.DialContext(ctx, "bufnet", grpc.WithContextDialer(bufDialer), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial bufnet: %v", err)
	}
	defer conn.Close()

	client := pb.NewTransactionEvaluatorClient(conn)
	resp, err := client.AuditTransaction(ctx, &pb.TransactionRequest{
		TransactionId:    "tx-003",
		OrganizationCnpj: "99888777000199",
		MonetaryValue:    2000000.00,
	})
	if err != nil {
		t.Fatalf("AuditTransaction failed: %v", err)
	}

	if resp.IsApproved {
		t.Errorf("expected not approved for value exceeding threshold")
	}
	if resp.ComplianceStatus != "value_exceeds_threshold" {
		t.Errorf("expected value_exceeds_threshold, got %s", resp.ComplianceStatus)
	}
}

func TestAuditTransaction_EmptyTransactionID(t *testing.T) {
	ctx := context.Background()
	conn, err := grpc.DialContext(ctx, "bufnet", grpc.WithContextDialer(bufDialer), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial bufnet: %v", err)
	}
	defer conn.Close()

	client := pb.NewTransactionEvaluatorClient(conn)
	_, err = client.AuditTransaction(ctx, &pb.TransactionRequest{
		TransactionId: "",
		MonetaryValue: 100.00,
	})
	if err == nil {
		t.Fatal("expected error for empty transaction_id")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %v", err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Errorf("expected InvalidArgument, got %s", st.Code())
	}
}

func TestFloat64Precision(t *testing.T) {
	ctx := context.Background()
	conn, err := grpc.DialContext(ctx, "bufnet", grpc.WithContextDialer(bufDialer), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial bufnet: %v", err)
	}
	defer conn.Close()

	client := pb.NewTransactionEvaluatorClient(conn)
	testValue := 1234567.89
	resp, err := client.AuditTransaction(ctx, &pb.TransactionRequest{
		TransactionId:    "tx-004",
		OrganizationCnpj: "11222333000181",
		MonetaryValue:    testValue,
	})
	if err != nil {
		t.Fatalf("AuditTransaction failed: %v", err)
	}

	if resp.ComplianceStatus != "value_exceeds_threshold" {
		t.Errorf("expected value_exceeds_threshold for %f, got %s", testValue, resp.ComplianceStatus)
	}
}

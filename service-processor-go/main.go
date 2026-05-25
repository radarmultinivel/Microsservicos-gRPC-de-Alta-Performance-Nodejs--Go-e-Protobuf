// Desenvolvido por L. A. Leandro
// São José dos Campos - SP
// Data: 25/05/2026

package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net"
	"strings"
	"time"

	pb "github.com/polyglot-grpc/service-processor-go/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	port = ":50051"
)

type server struct {
	pb.UnimplementedTransactionEvaluatorServer
}

func (s *server) AuditTransaction(ctx context.Context, req *pb.TransactionRequest) (*pb.TransactionResponse, error) {
	start := time.Now()

	sanitizedCNPJ := maskCNPJ(req.OrganizationCnpj)
	log.Printf("[AUDIT] tx=%s cnpj=%s value=%.2f payload=%s",
		req.TransactionId, sanitizedCNPJ, req.MonetaryValue, maskPayload(req.EncryptedPayload))

	if req.TransactionId == "" {
		return nil, status.Error(codes.InvalidArgument, "transaction_id is required")
	}

	isApproved := req.MonetaryValue > 0 && req.MonetaryValue < 1000000

	complianceStatus := "compliant"
	if !isApproved {
		complianceStatus = "flagged_for_review"
	}

	if req.MonetaryValue >= 1000000 {
		complianceStatus = "value_exceeds_threshold"
	}

	// Simula processamento financeiro intenso
	simulateWork(req.MonetaryValue)

	latency := time.Since(start).Microseconds()

	log.Printf("[RESULT] tx=%s approved=%v status=%s latency=%dµs",
		req.TransactionId, isApproved, complianceStatus, latency)

	return &pb.TransactionResponse{
		TransactionId:      req.TransactionId,
		IsApproved:         isApproved,
		ComplianceStatus:   complianceStatus,
		LatencyMicroseconds: latency,
	}, nil
}

func maskCNPJ(cnpj string) string {
	if len(cnpj) <= 4 {
		return "****"
	}
	return strings.Repeat("*", len(cnpj)-4) + cnpj[len(cnpj)-4:]
}

func maskPayload(payload string) string {
	if payload == "" {
		return ""
	}
	return fmt.Sprintf("[ENCRYPTED %d bytes]", len(payload))
}

func simulateWork(value float64) {
	// Intensidade proporcional ao valor monetario
	workFactor := int(value/1000) + 1
	if workFactor > 100 {
		workFactor = 100
	}
	// Pausa pseudoaleatoria para simular carga computacional
	time.Sleep(time.Duration(rand.Intn(workFactor%10+1)) * time.Millisecond)
}

func main() {
	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	s := grpc.NewServer(
		grpc.UnaryInterceptor(securityInterceptor),
	)
	pb.RegisterTransactionEvaluatorServer(s, &server{})

	log.Printf("gRPC server listening on %s (HTTP/2)", port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}

func securityInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	log.Printf("[SECURITY] mTLS hook ready - method=%s", info.FullMethod)
	return handler(ctx, req)
}

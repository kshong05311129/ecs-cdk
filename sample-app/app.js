const express = require('express');
const app = express();

const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());

// Health check endpoint (ALB가 사용)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Hello from ECS Fargate!',
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
  });
});

// Test API endpoint with Secrets
app.get('/api/test', (req, res) => {
  // Secrets Manager에서 주입된 환경변수 확인
  const hasOpenAiKey = !!process.env.OPENAI_API_KEY;
  const hasExternalApiKey = !!process.env.EXTERNAL_API_KEY;

  res.json({
    message: 'API Test Endpoint',
    secrets: {
      openai_api_key_exists: hasOpenAiKey,
      external_api_key_exists: hasExternalApiKey,
    },
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      LOG_LEVEL: process.env.LOG_LEVEL,
    },
  });
});

// Environment variables endpoint
app.get('/api/env', (req, res) => {
  // 민감한 정보는 제외하고 일반 환경변수만 반환
  const safeEnv = {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    PORT: PORT,
  };

  res.json({
    message: 'Environment variables',
    env: safeEnv,
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

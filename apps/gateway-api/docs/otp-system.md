# OTP System Documentation

## Overview

The OTP (One-Time Password) system provides secure phone-based authentication with Redis storage and SMS delivery.

## Architecture

```
Client → API Gateway → Auth Service → OTP Service → Redis → SMS/Email Provider
```

## Flow

1. **Request OTP**: Client requests OTP for phone number
2. **Validate & Rate Limit**: System validates phone and checks rate limits
3. **Generate OTP**: 6-digit secure random code generated
4. **Store in Redis**: OTP stored with 300-second TTL
5. **Send SMS**: OTP sent via configured SMS provider
6. **Verify OTP**: Client submits OTP for verification

## Configuration

### Environment Variables

- `OTP_TTL_SECONDS`: OTP expiration time (default: 300 seconds)
- `SMS_PROVIDER`: SMS provider (`twilio` or `msg91`)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: Twilio config
- `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`: MSG91 config

### Redis Keys

- `otp:{phone_hash}`: OTP data with TTL
- `otp_rate:{phone_hash}`: Rate limiting (3 requests per 15 minutes)

## API Endpoints

### Request OTP
- `POST /auth/citizen/otp/request`
- `POST /auth/authority/otp/request`
- `POST /auth/contractor/otp/request`

### Verify OTP
- `POST /auth/citizen/otp/verify`
- `POST /auth/authority/otp/verify`
- `POST /auth/contractor/otp/verify`

### Check OTP Status
- `GET /auth/citizen/otp/status?phone={phone}`
- `GET /auth/authority/otp/status?identifier={identifier}`
- `GET /auth/contractor/otp/status?identifier={identifier}`

## Security Features

- **Rate Limiting**: Max 3 OTP requests per 15 minutes per phone
- **Attempt Tracking**: Max 3 verification attempts per OTP
- **Phone Encryption**: PII protection with AES-256-GCM
- **Phone Hashing**: HMAC-based lookup keys
- **Secure Generation**: Cryptographically secure random codes
- **TTL Enforcement**: Automatic expiration after 300 seconds

## Error Handling

- Rate limit exceeded: Returns error after 3 requests
- Invalid OTP: Increments attempt counter
- Too many attempts: Deletes OTP after 3 failed attempts
- SMS failure: Logs error but continues (OTP still valid)

## Development

In development mode, test phone numbers from `test-acc.txt` receive the OTP code in the API response for testing purposes.
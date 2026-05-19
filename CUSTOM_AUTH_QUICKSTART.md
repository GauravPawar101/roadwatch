# RoadWatch Custom Authentication - Quick Start Guide

## What Changed

✅ **Removed**: Clerk authentication completely  
✅ **Added**: Custom auth with Gmail, Phone, Username  
✅ **Added**: Fabric identity verification for Authority & Contractor  
✅ **Added**: Public dashboard (no login required)  
✅ **Added**: Role-based route protection  

## Login/Signup URLs

### Citizens
- **Signup**: `http://localhost:5173/citizen/signup`
- **Login**: `http://localhost:5173/citizen/login`
- **Dashboard** (public): `http://localhost:5173/`

### Authority (CE/EE)
- **Signup**: `http://localhost:5173/authority/signup`
- **Login**: `http://localhost:5173/authority/login`
- **Dashboard**: `http://localhost:5173/dashboard/authority` (protected)

### Contractors
- **Signup**: `http://localhost:5173/contractor/signup`
- **Login**: `http://localhost:5173/contractor/login`
- **Dashboard**: `http://localhost:5173/dashboard/contractor` (protected)

## Testing the System

### 1. Test Citizen Signup
```
1. Go to /citizen/signup
2. Choose: Email, Phone, or Username
3. Password: Must have uppercase, lowercase, digit, special char (8+ chars)
   Example: TestPass123!
4. Confirm password
5. Click "Create Account"
6. Should redirect to /dashboard/citizen
```

### 2. Test Citizen Login
```
1. Logout (clear browser localStorage)
2. Go to /citizen/login
3. Enter email/phone/username + password
4. Click "Sign In"
5. Should redirect to /dashboard/citizen
```

### 3. Test Authority Signup
```
1. Go to /authority/signup
2. Fill: Email, Username, Password, Organization Name
3. Get Fabric certificate (PEM format)
4. Paste certificate and MSP ID
5. Submit
6. Should create account and verify Fabric identity
```

### 4. Test Protected Routes
```
1. Without login: Try /dashboard/authority
   → Should redirect to /
2. After citizen login: Try /dashboard/authority
   → Should show permission error
3. After authority login: Access /dashboard/authority
   → Should load dashboard
```

## Database Schema Changes

Run these commands to set up the new tables:

```sql
-- Adds password support to users
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN signup_method text DEFAULT 'otp';
ALTER TABLE users ADD COLUMN fabric_identity_id text;
ALTER TABLE users ADD COLUMN fabric_verified boolean DEFAULT false;

-- Creates Fabric identity table
CREATE TABLE fabric_identities (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('CE','EE','CONTRACTOR')),
  org_name text,
  cert_pem text NOT NULL,
  msp_id text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
```

The system handles this automatically on `initDb()` in the backend.

## Password Requirements

All passwords must contain:
```
✓ At least 8 characters
✓ At least 1 UPPERCASE letter
✓ At least 1 lowercase letter
✓ At least 1 digit (0-9)
✓ At least 1 special character: !@#$%^&*()_+=-[]{}';:"\\|,.<>/?
```

Example valid passwords:
- `SecurePass123!`
- `RoadWatch@2024`
- `Pwd#123abc`

## Token Storage

Auth tokens are stored in browser localStorage:
```
localStorage.getItem('roadwatch_token')      // JWT token
localStorage.getItem('roadwatch_user')       // User object (JSON)
localStorage.getItem('roadwatch_role')       // User role
localStorage.getItem('roadwatch_authority_id')   // Authority identifier
localStorage.getItem('roadwatch_contractor_id')  // Contractor identifier
```

Clear all by running in browser console:
```javascript
localStorage.clear()
```

## API Usage

All authenticated API calls need Bearer token:

```javascript
const token = localStorage.getItem('roadwatch_token');

fetch('http://localhost:3000/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
```

## Fabric Certificate Format

Certificate must be in PEM format:
```
-----BEGIN CERTIFICATE-----
MIICjTCCAhWgAwIBAgIUOhUJCJ...
[base64 encoded certificate data]
...7VhJjVDJn8oE=
-----END CERTIFICATE-----
```

You can generate test certificates using:
```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes
```

Then paste the contents of `cert.pem` into the signup form.

## Troubleshooting

### "Invalid credentials"
- Check email/phone/username is correct
- Check password is correct
- Ensure user exists in database

### "Fabric identity not verified"
- Authority/Contractor must have valid Fabric cert
- Cert must be in valid PEM format
- MSP ID must be provided

### "Password too weak"
- Add uppercase letter
- Add lowercase letter
- Add digit
- Add special character
- Make password 8+ characters

### "Email already registered"
- User with this email already exists
- Try different email or login instead

### Auth persists after page reload
- This is correct! Auth is stored in localStorage
- To test new login, clear localStorage first

## File Locations

### Backend Auth Files
- `apps/gateway-api/src/auth/password.ts` - Password hashing
- `apps/gateway-api/src/auth/fabric.ts` - Fabric verification
- `apps/gateway-api/src/routes/auth.ts` - Auth endpoints
- `apps/gateway-api/src/db.ts` - Database schema

### Frontend Auth Files
- `frontend/src/contexts/AuthContext.tsx` - Auth context
- `frontend/src/components/ProtectedRoute.tsx` - Route guards
- `frontend/src/pages/auth/*` - Login/Signup pages
- `frontend/src/App.tsx` - Route configuration

## Environment Variables

No Clerk environment variables needed anymore!

**Remove from `.env`**:
```
VITE_CLERK_PUBLISHABLE_KEY  ← DELETE THIS
```

**Backend still needs**:
```
# Cassandra (recommended):
CASSANDRA_CONTACT_POINTS=cassandra:9042
CASSANDRA_KEYSPACE=roadwatch
CASSANDRA_LOCAL_DC=datacenter1
# Legacy Postgres (optional):
# DATABASE_URL=postgresql://...
NODE_ENV=production
OTP_TTL_SECONDS=300
ALLOW_DEV_OTP_ECHO=true (dev only)
```

## Next Steps

1. ✅ Test citizen signup/login
2. ✅ Test authority signup/login with Fabric cert
3. ✅ Test contractor signup/login
4. ✅ Test protected routes redirect to login
5. ✅ Verify public dashboard loads without auth
6. ✅ Test logout clears all auth state
7. 📋 Deploy to production
8. 📋 Update documentation
9. 📋 Notify users of new login methods

## Support

If you encounter issues:
1. Check browser console for error messages
2. Check Network tab in DevTools for API errors
3. Check backend logs: `docker logs [container-name]`
4. Verify database tables exist: `\dt` in psql
5. Check that auth context is properly initialized

## Questions?

Refer to the detailed implementation guide at:
`CUSTOM_AUTH_IMPLEMENTATION.md`

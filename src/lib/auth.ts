import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET || 'super_secret_jwt_string_change_me_in_prod';
const key = new TextEncoder().encode(secretKey);

export async function encrypt(payload: any) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export async function decrypt(input: string): Promise<any> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ['HS256'],
  });
  return payload;
}

export async function getSession() {
  const session = (await cookies()).get('session')?.value;
  if (!session) return null;
  try {
    return await decrypt(session);
  } catch (error) {
    return null;
  }
}

export async function login(user: any) {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const session = await encrypt({ id: user.id, role: user.role, name: user.name, email: user.email });

  (await cookies()).set('session', session, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export async function logout() {
  (await cookies()).set('session', '', { expires: new Date(0) });
}

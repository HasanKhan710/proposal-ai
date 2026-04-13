import { getUserByEmail } from '@/lib/db';
import { login } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    const user = await getUserByEmail(email);

    if (!user || user.is_active === 0) {
      return NextResponse.json({ error: 'Invalid credentials or inactive account' }, { status: 401 });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password_hash);

    if (!passwordMatch) {
      return NextResponse.json({ error: 'Invalid credentials or inactive account' }, { status: 401 });
    }

    await login({ id: user.id, role: user.role, name: user.name, email: user.email });

    return NextResponse.json({ success: true, redirect: '/dashboard' });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

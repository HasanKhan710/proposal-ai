import { createUser, hasUserWithEmail, listUsers, updateUserRole, updateUserStatus } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await listUsers();
    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, name, password, role } = await request.json();

    if (!email || !name || !password) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const existingUser = await hasUserWithEmail(email);
    if (existingUser) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const user = await createUser({
      email,
      name,
      passwordHash,
      role: role || 'member',
    });

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, is_active, role } = await request.json();

    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
    if (id === session.id) return NextResponse.json({ error: 'Cannot modify your own account' }, { status: 400 });

    if (is_active !== undefined) {
      await updateUserStatus(id, Boolean(is_active));
    }
    
    if (role !== undefined) {
      await updateUserRole(id, role);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

import { deleteUserProposal, getUserProposalById, listUserProposals } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const proposal = await getUserProposalById(id, session.id);
      return NextResponse.json(proposal);
    }

    const proposals = await listUserProposals(session.id);
    return NextResponse.json(proposals);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    await deleteUserProposal(id, session.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete proposal' }, { status: 500 });
  }
}

import Sidebar from '@/components/Sidebar';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="app-container">
      <Sidebar user={session} />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

// A transaction as its own page (from the Transactions tab, reports, the planner…).
import { router, useLocalSearchParams } from 'expo-router';
import { TransactionEditor } from '@/components/TransactionEditor';

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TransactionEditor id={id} onDone={() => router.back()} />;
}


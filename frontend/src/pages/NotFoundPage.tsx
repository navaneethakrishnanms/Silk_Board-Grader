import { Link } from 'react-router-dom';
import { Button, Empty } from '@/components/ui';

export function NotFoundPage() {
  return (
    <Empty>
      <p className="mb-3">Page not found.</p>
      <Link to="/"><Button variant="outline">Go to dashboard</Button></Link>
    </Empty>
  );
}

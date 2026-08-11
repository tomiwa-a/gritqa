import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Review queue · GritQA' };

export default function QueuePage() {
  return (
    <StubPage
      icon="queue"
      nav="Review queue"
      title="Plans waiting for your approval"
      description="Nothing runs against your code until you say so. This is where drafts get read, edited, and approved."
      next="A side-by-side reader: the plan's steps and assertions on the left, the endpoints they touch on the right, approve or send back in one keystroke."
    />
  );
}

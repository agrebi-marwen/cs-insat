export type Tone = 'neutral' | 'success' | 'error' | 'strong';

export interface Message {
  text: string;
  tone: Tone;
}

export const TONE_COLOR: Record<Tone, string> = {
  neutral: 'inherit',
  strong: 'var(--text-strong)',
  success: '#83b5d1',
  error: '#fe4e00',
};

/** Status line under the account forms. Announced to screen readers. */
export function FormMessage({ message }: { message: Message | null }) {
  return (
    <div
      id="message"
      role="status"
      aria-live="polite"
      style={{
        margin: '10px 0',
        textAlign: 'center',
        fontWeight: 'bold',
        fontSize: 14,
        color: message ? TONE_COLOR[message.tone] : 'inherit',
      }}
    >
      {message?.text ?? ''}
    </div>
  );
}

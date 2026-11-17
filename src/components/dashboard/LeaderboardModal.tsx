'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { unwrap, useSupabase } from '@/components/Providers';
import { Modal } from './Modal';

const PAGE = 50;

interface Row {
  username: string;
  total_points: number | null;
}

export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const supabase = useSupabase();

  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['leaderboard'],
    initialPageParam: 0,
    staleTime: 30_000,
    queryFn: ({ pageParam }) =>
      unwrap<Row[]>(
        supabase
          .from('profiles')
          .select('username, total_points')
          .order('total_points', { ascending: false })
          .range(pageParam, pageParam + PAGE - 1),
      ).then((rows) => rows ?? []),
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });

  const rows = data?.pages.flat() ?? [];

  return (
    <Modal id="leaderboard-modal" title="🏆 Leaderboard" subtitle="Top members ranked by points." onClose={onClose}>
      <div className="modal-table-container">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Member Name</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody id="leaderboard-tbody">
            {isPending && (
              <tr><td colSpan={3} className="modal-loading">Loading leaderboard...</td></tr>
            )}
            {error && (
              <tr><td colSpan={3} className="modal-loading">Failed to load leaderboard.</td></tr>
            )}
            {!isPending && !error && rows.length === 0 && (
              <tr><td colSpan={3} className="modal-loading">No members yet.</td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={`${i}-${row.username}`}>
                <td><strong>#{i + 1}</strong></td>
                <td>{row.username}</td>
                <td>{row.total_points ?? 0} pts</td>
              </tr>
            ))}
            {hasNextPage && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: 15 }}>
                  <button
                    type="button"
                    className="load-more-btn"
                    disabled={isFetchingNextPage}
                    onClick={() => void fetchNextPage()}
                  >
                    {isFetchingNextPage ? 'Loading...' : 'Load More Members'}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// Plain <a> links on purpose: moving between the landing page, the account
// pages and the dashboard is a full page load, because each section ships its
// own stylesheet with section-wide rules (body, layout).

export function SiteFooter({ showDashboard = false }: { showDashboard?: boolean }) {
  return (
    <footer className="temporal-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <div className="logo">
            <span className="logo-cube">◈</span>
            The Time Portal
          </div>
          <p className="footer-tagline">Built by the IEEE CS INSAT Student Branch Chapter.</p>
        </div>

        <div className="footer-links-group">
          <h4>Navigation</h4>
          <ul className="footer-links">
            <li><a href="/">Home</a></li>
            {showDashboard && <li><a href="/dashboard/dashboard">Dashboard</a></li>}
            <li><a href="/dashboard/challenges">Challenges</a></li>
          </ul>
        </div>

        <div className="footer-links-group">
          <h4>Connect</h4>
          <ul className="footer-links">
            <li><a href="https://www.facebook.com/INSAT.CS" target="_blank" rel="noopener noreferrer">IEEE CS INSAT</a></li>
            <li><a href="https://www.facebook.com/IeeeInsatStudentBranch" target="_blank" rel="noopener noreferrer">IEEE INSAT SB</a></li>
            <li><a href="https://insat.rnu.tn" target="_blank" rel="noopener noreferrer">INSAT Space</a></li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; 2026 IEEE Computer Society INSAT Student Branch Chapter. All rights reserved.</p>
        <p className="system-status"><span className="status-indicator"></span> System online</p>
      </div>
    </footer>
  );
}

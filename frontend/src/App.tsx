import { NavLink, Route, Routes } from "react-router-dom";
import { PlayerPage } from "./pages/PlayerPage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  return (
    <>
      <header className="topbar">
        <strong>Conversation Flow</strong>
        <nav>
          <NavLink to="/" end>
            Player
          </NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<PlayerPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </>
  );
}

import { useState } from "react";
import MapViewComponent from "./components/MapView.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";

export default function App() {
  const [view, setView] = useState(null);

  return (
    <div className="app-container">
      <MapViewComponent onViewReady={setView} />
      <ChatSidebar view={view} />
    </div>
  );
}

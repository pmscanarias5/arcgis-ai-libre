import { useState } from "react";
import MapViewComponent from "./components/MapView.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";
import AttributeTablePanel from "./components/AttributeTablePanel.jsx";

export default function App() {
  const [view, setView] = useState(null);
  const [tableLayer, setTableLayer] = useState(null);

  return (
    <div className="app-shell">
      <div className="app-container">
        <MapViewComponent onViewReady={setView} onOpenTable={setTableLayer} />
        <ChatSidebar view={view} />
      </div>
      <AttributeTablePanel view={view} layer={tableLayer} onClose={() => setTableLayer(null)} />
    </div>
  );
}
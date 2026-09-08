import { useState } from "react";
import MapViewComponent from "./components/MapView.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";
import AttributeTablePanel from "./components/AttributeTablePanel.jsx";
import QueryResultsPanel from "./components/QueryResultsPanel.jsx";

export default function App() {
  const [view, setView] = useState(null);
  const [tableLayer, setTableLayer] = useState(null);
  const [queryResults, setQueryResults] = useState(null);

  return (
    <div className="app-shell">
      <div className="app-container">
        <div className="map-column">
          <MapViewComponent onViewReady={setView} onOpenTable={setTableLayer} />
          <QueryResultsPanel results={queryResults} onClose={() => setQueryResults(null)} />
          <AttributeTablePanel
            view={view}
            layer={tableLayer}
            onSelectLayer={setTableLayer}
            onClose={() => setTableLayer(null)}
          />
        </div>
        <ChatSidebar view={view} onResults={setQueryResults} />
      </div>
    </div>
  );
}
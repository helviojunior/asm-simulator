import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DialogProvider } from "contexts/DialogContext";
import { ToastProvider } from "contexts/ToastContext";
import { I18nProvider } from "i18n";
import AppLayout from "components/layout/AppLayout";
import Dashboard from "pages/Dashboard";
import Simulator from "pages/Simulator";
import "./App.css";

function App() {
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  return (
    <div className="App">
      <BrowserRouter>
        {/* Projeto publico: sem login, o idioma vem do navegador (fallback EN). */}
        <I18nProvider>
          <DialogProvider>
            <ToastProvider>
            <Routes>
              {/* O simulador ocupa a janela inteira: um debugger nao divide
                  espaco com sidebar. Por isso fica fora do AppLayout. */}
              <Route path="/simulator" element={<Simulator />} />

              <Route element={<AppLayout darkMode={darkMode} setDarkMode={setDarkMode} />}>
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>

              <Route path="/" element={<Navigate to="/simulator" replace />} />
              <Route path="*" element={<Navigate to="/simulator" replace />} />
            </Routes>
            </ToastProvider>
          </DialogProvider>
        </I18nProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;

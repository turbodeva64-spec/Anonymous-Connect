import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext.tsx';
import { WelcomePage } from './pages/WelcomePage.tsx';
import { GuestIdentityPage } from './pages/GuestIdentityPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { UserDiscoveryPage } from './pages/UserDiscoveryPage.tsx';
import { ChatRequestsPage } from './pages/ChatRequestsPage.tsx';
import { PrivateChatPage } from './pages/PrivateChatPage.tsx';
import { SettingsPrivacyPage } from './pages/SettingsPrivacyPage.tsx';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/identity" element={<GuestIdentityPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/discover" element={<UserDiscoveryPage />} />
          <Route path="/requests" element={<ChatRequestsPage />} />
          <Route path="/chat/:conversationId" element={<PrivateChatPage />} />
          <Route path="/settings" element={<SettingsPrivacyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

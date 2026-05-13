"use client";

import { useState } from "react";
import Card from "./Card";
import Button from "./Button";

interface SyncService {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  email?: string;
  lastSync?: string;
  type: "google";
}

interface SyncManagerProps {
  onConnect?: (serviceId: string) => void;
  onDisconnect?: (serviceId: string) => void;
  onSync?: (serviceId: string) => void;
}

export default function SyncManager({ onConnect, onDisconnect, onSync }: SyncManagerProps) {
  const [services, setServices] = useState<SyncService[]>([
    { id: "google-calendar", name: "Google Calendar", icon: "📅", connected: true, email: "garcia@gmail.com", lastSync: "2 min ago", type: "google" },
    { id: "google-tasks", name: "Google Tasks", icon: "✅", connected: true, email: "garcia@gmail.com", lastSync: "5 min ago", type: "google" },
    { id: "google-keep", name: "Google Keep", icon: "📝", connected: false, type: "google" },
    { id: "google-shopping", name: "Google Shopping List", icon: "🛒", connected: false, type: "google" },
  ]);

  const handleConnect = (serviceId: string) => {
    setServices(services.map(service => 
      service.id === serviceId 
        ? { ...service, connected: true, lastSync: "Just now", email: "garcia@gmail.com" }
        : service
    ));
    onConnect?.(serviceId);
  };

  const handleDisconnect = (serviceId: string) => {
    setServices(services.map(service => 
      service.id === serviceId 
        ? { ...service, connected: false, email: undefined, lastSync: undefined }
        : service
    ));
    onDisconnect?.(serviceId);
  };

  const handleSync = (serviceId: string) => {
    setServices(services.map(service => 
      service.id === serviceId 
        ? { ...service, lastSync: "Just now" }
        : service
    ));
    onSync?.(serviceId);
  };

  return (
    <div className="space-y-6">
      {/* Google Services */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-lg">🔍</div>
          <h3 className="text-text-primary font-semibold text-sm">Google Services</h3>
        </div>
        <Card>
          <div className="space-y-4">
            {services.map(service => (
              <div key={service.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{service.icon}</span>
                  <div>
                    <p className="text-text-primary text-sm font-medium">{service.name}</p>
                    {service.connected && service.email && (
                      <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mt-0.5">{service.email}</p>
                    )}
                    {service.connected && service.lastSync && (
                      <p className="text-nori-400 text-[10px] font-bold">Last sync: {service.lastSync}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {service.connected ? (
                    <>
                      <Button 
                        variant="secondary" 
                        size="sm"
                        className="!text-[10px] !py-1"
                        onClick={() => handleSync(service.id)}
                      >
                        Sync
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="!text-[10px] !py-1 text-rose-400 hover:bg-rose-500/10"
                        onClick={() => handleDisconnect(service.id)}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button 
                      variant="primary" 
                      size="sm"
                      className="!text-[10px] !py-1"
                      onClick={() => handleConnect(service.id)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Sync Status */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-lg">🔄</div>
          <h3 className="text-text-primary font-semibold text-sm">Sync Status</h3>
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 rounded-2xl bg-surface-2/50 border border-white/5">
              <p className="text-2xl font-bold text-nori-400">
                {services.filter(s => s.connected).length}
              </p>
              <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold">Active Connections</p>
            </div>
            <div className="text-center p-3 rounded-2xl bg-surface-2/50 border border-white/5">
              <p className="text-2xl font-bold text-nori-400">142</p>
              <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold">Total Items</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-surface-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-primary text-sm font-semibold">Consuela Brain Sync</p>
                <p className="text-text-muted text-xs">Everything is up to date</p>
              </div>
              <Button variant="secondary" size="sm" className="!text-[10px] uppercase tracking-widest font-bold">
                Sync All
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
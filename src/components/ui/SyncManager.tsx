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
  type: "google" | "apple";
}

interface SyncManagerProps {
  onConnect?: (serviceId: string) => void;
  onDisconnect?: (serviceId: string) => void;
  onSync?: (serviceId: string) => void;
}

export default function SyncManager({ onConnect, onDisconnect, onSync }: SyncManagerProps) {
  const [services, setServices] = useState<SyncService[]>([
    { id: "google-calendar", name: "Google Calendar", icon: "📅", connected: true, email: "sarah@gmail.com", lastSync: "2 min ago", type: "google" },
    { id: "google-tasks", name: "Google Tasks", icon: "✅", connected: false, type: "google" },
    { id: "google-keep", name: "Google Keep", icon: "📝", connected: false, type: "google" },
    { id: "google-shopping", name: "Google Shopping List", icon: "🛒", connected: false, type: "google" },
    { id: "apple-calendar", name: "Apple Calendar", icon: "🍎", connected: false, type: "apple" },
    { id: "apple-reminders", name: "Apple Reminders", icon: "📋", connected: false, type: "apple" },
    { id: "apple-notes", name: "Apple Notes", icon: "📒", connected: false, type: "apple" },
  ]);

  const handleConnect = (serviceId: string) => {
    // In a real implementation, this would trigger OAuth flow
    setServices(services.map(service => 
      service.id === serviceId 
        ? { ...service, connected: true, lastSync: "Just now" }
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

  const googleServices = services.filter(s => s.type === "google");
  const appleServices = services.filter(s => s.type === "apple");

  return (
    <div className="space-y-6">
      {/* Google Services */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">🔍</span>
          <h3 className="text-text-primary font-semibold text-sm">Google Services</h3>
        </div>
        <Card>
          <div className="space-y-4">
            {googleServices.map(service => (
              <div key={service.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{service.icon}</span>
                  <div>
                    <p className="text-text-primary text-sm font-medium">{service.name}</p>
                    {service.connected && service.email && (
                      <p className="text-text-muted text-xs">{service.email}</p>
                    )}
                    {service.connected && service.lastSync && (
                      <p className="text-nori-400 text-xs">Last sync: {service.lastSync}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {service.connected ? (
                    <>
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => handleSync(service.id)}
                      >
                        Sync
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDisconnect(service.id)}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button 
                      variant="primary" 
                      size="sm"
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

      {/* Apple iCloud Services */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">🍎</span>
          <h3 className="text-text-primary font-semibold text-sm">Apple iCloud Services</h3>
        </div>
        <Card>
          <div className="space-y-4">
            {appleServices.map(service => (
              <div key={service.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{service.icon}</span>
                  <div>
                    <p className="text-text-primary text-sm font-medium">{service.name}</p>
                    {service.connected && service.email && (
                      <p className="text-text-muted text-xs">{service.email}</p>
                    )}
                    {service.connected && service.lastSync && (
                      <p className="text-nori-400 text-xs">Last sync: {service.lastSync}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {service.connected ? (
                    <>
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => handleSync(service.id)}
                      >
                        Sync
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDisconnect(service.id)}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button 
                      variant="primary" 
                      size="sm"
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
          <span className="text-xl">🔄</span>
          <h3 className="text-text-primary font-semibold text-sm">Sync Status</h3>
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-nori-400">
                {services.filter(s => s.connected).length}
              </p>
              <p className="text-text-muted text-xs">Connected Services</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-nori-400">24</p>
              <p className="text-text-muted text-xs">Items Synced</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-surface-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-primary text-sm font-medium">Last Full Sync</p>
                <p className="text-text-muted text-xs">2 minutes ago</p>
              </div>
              <Button variant="secondary" size="sm">
                Sync All
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
"use client";

import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { Stop } from "@/lib/gtfs";
import type { LiveVehicle } from "@/lib/live-transport";

function Recenter({ stop }: { stop?: Stop }) {
  const map = useMap();
  useEffect(() => {
    if (stop) map.flyTo([stop.latitude, stop.longitude], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, stop?.id, stop?.latitude, stop?.longitude]);
  return null;
}

function FitRoute({ shape }: { shape: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (shape.length > 1) map.fitBounds(shape, { padding: [40, 40], maxZoom: 15, animate: true });
  }, [map, shape]);
  return null;
}

export default function TransitMap({ stops, vehicles, routeShape, selectedStopId, selectedVehicleId, onSelect, onSelectVehicle }: {
  stops: Stop[];
  vehicles: LiveVehicle[];
  routeShape: Array<[number, number]>;
  selectedStopId: string | null;
  selectedVehicleId: string | null;
  onSelect: (stop: Stop) => void;
  onSelectVehicle: (vehicle: LiveVehicle) => void;
}) {
  const selectedStop = stops.find((stop) => stop.id === selectedStopId);

  return (
    <MapContainer center={[42.1354, 24.7453]} zoom={13} className="transit-map" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter stop={selectedStop} />
      <FitRoute shape={routeShape} />
      {routeShape.length > 1 && (
        <Polyline
          positions={routeShape}
          pathOptions={{ color: "#f3c969", opacity: 0.96, weight: 6, lineCap: "round", lineJoin: "round" }}
        />
      )}
      {vehicles.map((vehicle) => (
        <CircleMarker
          key={vehicle.id}
          center={[vehicle.latitude, vehicle.longitude]}
          radius={vehicle.id === selectedVehicleId ? 9 : 6}
          pathOptions={{
            color: vehicle.id === selectedVehicleId ? "#172b2b" : "#ffffff",
            fillColor: vehicle.id === selectedVehicleId ? "#f0c84b" : "#f15b42",
            fillOpacity: 1,
            weight: 2,
          }}
          eventHandlers={{ click: () => onSelectVehicle(vehicle) }}
        >
          <Tooltip direction="top">
            <strong>Line {vehicle.lineId}</strong>{vehicle.destination?.en || vehicle.destination?.bg ? ` · ${vehicle.destination.en || vehicle.destination.bg}` : ""}
            <br />Reported {Math.max(0, Math.floor((Date.now() - vehicle.lastUpdated) / 1000))} sec ago
          </Tooltip>
        </CircleMarker>
      ))}
      {stops.map((stop) => (
        <CircleMarker
          key={stop.id}
          center={[stop.latitude, stop.longitude]}
          radius={stop.id === selectedStopId ? 7 : 4}
          pathOptions={{ color: stop.id === selectedStopId ? "#f15b42" : "#187b72", fillOpacity: 0.9, weight: 2 }}
          eventHandlers={{ click: () => onSelect(stop) }}
        >
          <Tooltip>{stop.name}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
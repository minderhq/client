import { useLocation, type Location } from "react-router-dom";

/** Reports the router's current location on every render (test helper). */
export function LocationProbe({ onLocation }: { onLocation: (location: Location) => void }) {
  onLocation(useLocation());
  return null;
}

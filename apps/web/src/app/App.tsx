import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ApplyTheme } from "../theme";

export function App() {
  return <><ApplyTheme /><RouterProvider router={router} /></>;
}

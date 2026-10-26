// Pictures imported from Vue files become hashed files in assets/ (the only folder the API serves besides the page).
declare module "*.png" {
  const url: string;
  export default url;
}

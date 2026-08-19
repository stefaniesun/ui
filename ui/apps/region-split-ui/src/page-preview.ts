export interface PagePreviewAsset {
  path: string;
  contentBase64: string;
}

export interface PagePreviewInput {
  html: string;
  css: string;
  assets: readonly PagePreviewAsset[];
}

const imageMime = (path: string): string => {
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/png";
};

const RESOURCE_ATTRIBUTE = /\b(src|poster)=(['"])(.*?)\2/gi;
const REMOTE_URL = /(?:https?:)?\/\/[^\s'"<>)]+/gi;
const isRemoteUrl = (value: string): boolean => /^(?:https?:)?\/\//i.test(value);

export function pagePreviewDocument(input: PagePreviewInput): string {
  const assets = new Map(input.assets.map(asset => [
    asset.path,
    `data:${imageMime(asset.path)};base64,${asset.contentBase64}`,
  ]));
  const html = input.html
    .replace(/<link\b[^>]*\bhref=(['"])style\.css\1[^>]*>/gi, "")
    .replace(RESOURCE_ATTRIBUTE, (attribute, name: string, quote: string, value: string) => {
    const source = assets.get(value);
    if (source) return `${name}=${quote}${source}${quote}`;
    if (isRemoteUrl(value)) return `${name}=${quote}about:blank${quote}`;
    return attribute;
  });
  const css = input.css.replaceAll("</style", "<\\/style").replace(REMOTE_URL, "about:blank");
  return [
    "<!doctype html><meta charset=\"utf-8\">",
    `<style>*{margin:0;padding:0;box-sizing:border-box}html,body{overflow:hidden}${css}</style>`,
    html,
  ].join("");
}

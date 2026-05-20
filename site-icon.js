(function () {
  const host = window.location.hostname;
  const intervalHosts = new Set(["model-eval.ethan7zhanghx.com"]);
  if (!host.includes("interval-model-eval") && !intervalHosts.has(host)) return;

  const iconHref = "/interval-model-eval-icon.png?v=1";
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.type = "image/png";
  icon.href = iconHref;
  document.head.appendChild(icon);

  const appleIcon = document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  appleIcon.href = iconHref;
  document.head.appendChild(appleIcon);
})();

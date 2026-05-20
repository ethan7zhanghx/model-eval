(function () {
  const host = window.location.hostname;
  if (!host.includes("interval-model-eval")) return;

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

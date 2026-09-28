(function () {
  "use strict";
  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());

  var header = document.querySelector(".site-header");
  var bar = document.getElementById("mobile-bar");
  var hero = document.querySelector(".hero");
  var ticking = false;
  function onScroll() {
    ticking = false;
    var sy = window.scrollY;
    if (header) header.classList.toggle("scrolled", sy > 8);
    if (bar && hero) {
      var pastHero = sy > hero.offsetHeight - 120;
      var nearEnd = window.innerHeight + sy > document.body.scrollHeight - 260;
      bar.classList.toggle("show", pastHero && !nearEnd);
    }
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  // Fade sections in as they come into view.
  var targets = [].slice.call(document.querySelectorAll("[data-reveal]"));
  document.querySelectorAll("[data-reveal-group]").forEach(function (g) {
    [].slice.call(g.children).forEach(function (c, i) {
      c.style.transitionDelay = Math.min(i, 5) * 90 + "ms";
      targets.push(c);
    });
  });
  if (!("IntersectionObserver" in window)) {
    targets.forEach(function (t) { t.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var t = e.target;
      t.classList.add("in");
      io.unobserve(t);
      setTimeout(function () { t.style.transitionDelay = ""; }, 1400); // so hover effects aren't delayed later
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  targets.forEach(function (t) { io.observe(t); });
})();

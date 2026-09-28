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

  // Hero reel: respect reduced motion, and pause it when it's off screen to save battery.
  var vid = document.querySelector(".hero-video");
  if (vid) {
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { vid.removeAttribute("autoplay"); vid.pause(); }
    else if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { var p = vid.play(); if (p && p.catch) p.catch(function () {}); } else vid.pause(); });
      }).observe(vid);
    }
  }

  // Tap a gallery photo to see it bigger.
  var lb = document.getElementById("lightbox");
  if (lb && typeof lb.showModal === "function") {
    var lbImg = lb.querySelector("img");
    document.querySelectorAll(".gallery .shot").forEach(function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var img = a.querySelector("img");
        lbImg.src = a.getAttribute("href");
        lbImg.alt = img ? img.alt : "";
        lb.showModal();
      });
    });
    lb.addEventListener("click", function () { lb.close(); });
  }

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

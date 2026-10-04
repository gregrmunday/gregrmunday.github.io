---
layout: onepage
permalink: /
title: "Gregory Munday"
excerpt: "Climate scientist and DPhil researcher at Oxford, working on hybrid physics and AI for atmospheric modelling."
author_profile: false
redirect_from:
  - /about/
  - /about.html
---
<section class="home-intro" id="about" aria-labelledby="about-heading" tabindex="-1">
  <p class="home-eyebrow">{{ site.data.home.eyebrow | escape }}</p>
  <h1 id="about-heading">{{ site.data.home.headline | escape }}</h1>
  <p>{{ site.data.home.intro | escape }}</p>
  <p class="home-intro__background">{{ site.data.home.background | escape }}</p>
  <ul class="home-research" aria-label="Research interests">
    {% for interest in site.data.home.research %}<li>{{ interest | escape }}</li>{% endfor %}
  </ul>
  <p class="home-intro__contact">{{ site.data.home.contact | escape }}</p>
</section>

<section class="home-section" id="publications" aria-labelledby="publications-heading">
  <header class="home-section__heading">
    <h2 id="publications-heading">Publications</h2>
    <p><a href="{{ site.author.orcid | escape }}">ORCID</a> + <a href="{{ site.author.googlescholar | escape }}">Google Scholar</a></p>
  </header>
  {% include orcid-publications.html compact=true %}
</section>

<section class="home-section" id="talks" aria-labelledby="talks-heading">
  <header class="home-section__heading">
    <h2 id="talks-heading">Talks &amp; presentations</h2>
    <p>Talks, posters &amp; co-authored work</p>
  </header>
  {% include talks-atlas.html compact=true %}
</section>

{% if site.data.extracurricular.activities.size > 0 %}
<section class="home-section" id="extracurricular" aria-labelledby="extracurricular-heading">
  <header class="home-section__heading">
    <h2 id="extracurricular-heading">Beyond research</h2>
    <p>Outside of model world</p>
  </header>
  {% include extracurricular.html %}
</section>
{% endif %}

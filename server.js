const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cacheMiddleware = require('./cacheMiddleware');


require('dotenv').config();

const app = express();
app.use(cors());

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const PORT = process.env.PORT || 3000;
function normalizeTMDBItem(item, type) {
  const posterPath = item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : null;

  const backdropPath = item.backdrop_path
    ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
    : posterPath;

  const releaseDate = item.release_date || item.first_air_date || '';
  const year = releaseDate.split('-')[0] || 'N/A';

  return {
    tmdb_id: item.id,
    title: item.title || item.name,
    poster: posterPath,
    backdrop: backdropPath,
    release_date: releaseDate,
    year,
    overview: item.overview || '',
    rating: item.vote_average || 0,
    runtime: item.runtime || null,  // will be overwritten later from details
    genres: [],                     // placeholder, filled in after details fetch
    type,
  };
}
// Route: /search
app.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query string' });

  try {
    const response = await axios.get('https://api.themoviedb.org/3/search/multi', {
      params: {
        api_key: TMDB_API_KEY,
        query,
        include_adult: false,
      },
    });

   const results = response.data.results
  .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
  .map((item) => ({
    title: item.title || item.name,
    tmdb_id: item.id,
    poster: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : null,
    type: item.media_type, // 'movie' or 'tv'
    vote_average: item.vote_average || 0,
    release_date: item.release_date || item.first_air_date || 'N/A',
    adult: item.adult || false,
    genre_ids: item.genre_ids || [],
    overview: item.overview || '',
  }));


    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Multi search failed', details: err.message });
  }
});
// Route: /genre
app.get('/genre/top', async (req, res) => {
  const genreId = req.query.id;
  const type = req.query.type || 'movie';

  if (!genreId) return res.status(400).json({ error: 'Missing genre id' });

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, {
      params: {
        api_key: TMDB_API_KEY,
        with_genres: genreId,
        sort_by: 'popularity.desc',
        'vote_count.gte': 300, // ✅ Corrected key
        include_adult: false,
        include_video: false,
        'with_original_language': 'en',
        'with_runtime.gte': 60,
        language: 'en-US',
        page: 1,
      },
    });

    const results = response.data.results
      .filter(item => item.id && item.poster_path && (item.title || item.name))
      .slice(0, 3)
      .map(item => normalizeTMDBItem(item, type));

    res.json(results);
  } catch (err) {
    console.error('Top picks fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Top picks fetch failed' });
  }
});

app.get('/genre/combos', async (req, res) => {
  const genreId = req.query.id;
  const type = req.query.type || 'movie';

  if (!genreId) return res.status(400).json({ error: 'Missing genre id' });

  const genreMap = type === 'tv'
    ? {
        10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
        99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
        10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
        10767: "Talk", 10768: "War & Politics", 37: "Western",
      }
    : {
        28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
        99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
        27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
        10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
      };

  const genreName = genreMap[genreId];

  const filters = [
    { label: 'Fan Favorites', sort_by: 'popularity.desc', with_genres: genreId },
    { label: 'Top Rated', sort_by: 'vote_average.desc', with_genres: genreId },
    { label: 'Latest Releases', sort_by: 'release_date.desc', with_genres: genreId },
  ];

  // ✅ Curated combos for TV (only use if genreId is in this map)
  const curatedTVCombos = {
    10759: ['35', '18'],         // Action & Adventure + Comedy / Drama
    18: ['9648', '10765'],       // Drama + Mystery / Sci-Fi
    10765: ['18', '9648'],       // Sci-Fi + Drama / Mystery
    35: ['10759'],               // Comedy + Action
    9648: ['18'],                // Mystery + Drama
  };

  let relatedCombos = [];

  if (type === 'tv' && curatedTVCombos[genreId]) {
    relatedCombos = curatedTVCombos[genreId]
      .map(id => [id, genreMap[id]])
      .filter(([id, name]) => id && name);
  } else {
    relatedCombos = Object.entries(genreMap)
      .filter(([id]) => id !== genreId)
      .slice(0, 3);
  }

  relatedCombos.forEach(([relatedId, relatedName]) => {
    filters.push({
      label: `${genreName} + ${relatedName}`,
      sort_by: 'popularity.desc',
      with_genres: `${genreId},${relatedId}`,
    });
  });

  try {
    const comboResults = {};

    for (const filter of filters) {
      const params = {
        api_key: TMDB_API_KEY,
        with_genres: filter.with_genres,
        sort_by: filter.sort_by,
        include_adult: false,
        include_video: false,
        'certification.lte': 'R',
        'with_runtime.gte': 60,
        'with_original_language': 'en',
        language: 'en-US',
        page: 1,
      };

      if (filter.sort_by === 'vote_average.desc') {
        params['vote_count.gte'] = 300;
      }

      const response = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, { params });

      const items = response.data.results
        .filter(item => item.id && item.poster_path && (item.title || item.name))
        .slice(0, 10)
        .map(item => normalizeTMDBItem(item, type));

      if (items.length > 0) {
        comboResults[filter.label] = items;
      }
    }

    res.json(comboResults);
  } catch (err) {
    console.error('Combos fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Combos fetch failed' });
  }
});

app.get('/random', async (req, res) => {
  const { type = 'movie', genreId } = req.query;
  try {
    // Prepare base discover params
    const params = {
      api_key: TMDB_API_KEY,
      language: 'en-US',
      include_adult: false,
      sort_by: 'popularity.desc',
    };
    if (genreId) params.with_genres = genreId;
    // First, get the first page to determine total pages
    const firstPageUrl = `https://api.themoviedb.org/3/discover/${type}`;
    const firstRes = await axios.get(firstPageUrl, { params: { ...params, page: 1 } });
    let totalPages = firstRes.data.total_pages;
    if (totalPages > 500) totalPages = 500;  // API max cap
    // Pick a random page and fetch it (if totalPages is 0, return none)
    if (totalPages < 1) return res.json(null);
    const randomPage = Math.floor(Math.random() * totalPages) + 1;
    const pageRes = (randomPage === 1) 
      ? firstRes 
      : await axios.get(firstPageUrl, { params: { ...params, page: randomPage } });
    const results = pageRes.data.results.filter(item => item.poster_path);
    if (!results.length) return res.json(null);
    // Pick a random item from this page
    const randomIndex = Math.floor(Math.random() * results.length);
    const randomItem = normalizeTMDBItem(results[randomIndex], type);
    return res.json(randomItem);
  } catch (err) {
    console.error('Random fetch failed:', err.message);
    res.status(500).json({ error: 'Random fetch failed' });
  }
});
// Route: /homepage/genres
app.get('/homepage/genres', async (req, res) => {
  const type = req.query.type || 'movie';

  // Curated genre mapping by media type
  const homepageGenreMap = {
    movie: {
      Action: 28,
      Comedy: 35,
      Horror: 27,
      Drama: 18,
      SciFi: 878,
      Romance: 10749,
    },
    tv: {
      Action: 10759,                  // Action & Adventure
      Comedy: 35,
      Horror: 9648,                   // using Mystery as Horror proxy
      Drama: 18,
      SciFi: 10765,                   // Sci-Fi & Fantasy
      Romance: 10766,                // using Soap as Romance proxy
    },
  };

  const selectedGenres = homepageGenreMap[type];

  if (!selectedGenres) {
    return res.status(400).json({ error: 'Unsupported media type' });
  }

  const sections = {};

  try {
    for (const [label, genreId] of Object.entries(selectedGenres)) {
      const response = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, {
        params: {
          api_key: process.env.TMDB_API_KEY,
          with_genres: genreId,
          sort_by: 'popularity.desc',
          vote_count_gte: 100,
          include_adult: false,
          language: 'en-US',
          page: 1,
        },
      });

      const items = response.data.results
        .filter(item => item.poster_path && (item.title || item.name))
        .slice(0, 10)
        .map(item => normalizeTMDBItem(item, type));

      sections[genreId] = items;
    }

    res.json(sections);
  } catch (err) {
    console.error('Genre homepage fetch failed:', err.message);
    res.status(500).json({ error: 'Genre homepage fetch failed' });
  }
});
// Route: /genre
app.get('/details', async (req, res) => {
  const id = req.query.id;
  const type = req.query.type || 'movie';

  if (!id) return res.status(400).json({ error: 'Missing TMDB ID' });

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/${type}/${id}`, {
      params: {
        api_key: TMDB_API_KEY,
        append_to_response: 'external_ids,videos',
      },
    });

    const data = response.data;

    // 🔍 Grab trailer (YouTube only)
    const trailer = data.videos?.results?.find(
      (v) => v.type === 'Trailer' && v.site === 'YouTube'
    );
    const trailerUrl = trailer ? `https://www.youtube.com/embed/${trailer.key}` : null;

    // 📌 Grab recommendations first
    let similar = [];
    if (type === 'movie') {
      let recRes = await axios.get(`https://api.themoviedb.org/3/movie/${id}/recommendations`, {
        params: { api_key: TMDB_API_KEY, language: 'en-US', page: 1 },
      });

      let candidates = recRes.data.results;

      // ⛳ fallback to similar if not enough recommendations
      if (!candidates || candidates.length < 5) {
        const simRes = await axios.get(`https://api.themoviedb.org/3/movie/${id}/similar`, {
          params: { api_key: TMDB_API_KEY, language: 'en-US', page: 1 },
        });
        candidates = simRes.data.results;
      }

      similar = candidates
        .filter((m) => m.poster_path)
        .slice(0, 10)
        .map((m) => ({
          tmdb_id: m.id,
          title: m.title,
          poster: `https://image.tmdb.org/t/p/w500${m.poster_path}`,
          rating: m.vote_average,
          year: m.release_date?.split('-')[0],
        }));
    }

 const payload = {
  tmdb_id: id,
  title: data.title || data.name,
  description: data.overview || '',
  poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
  backdrop: data.backdrop_path
    ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
    : null,
  release_date: data.release_date || data.first_air_date,
  runtime: data.runtime || null,
  genres: (data.genres || []).map((g) => g.name),
  embedUrls: {
    server1: type === 'movie'
      ? `https://vidsrc.to/embed/movie/${id}`
      : `https://vidsrc.to/embed/tv/${data.external_ids?.imdb_id || id}`,
    server2: type === 'movie'
      ? `https://embed.q62movies.ws/movie?tmdbId=${id}`
      : `https://embed.q62movies.ws/tv-show?tvdbId=${data.external_ids?.tvdb_id || ''}&s=1&e=1`,
  },
  trailerUrl,
  similar,
  type,
};
    // 🎞 TV-specific: add seasons
    if (type === 'tv') {
      payload.imdb_id = data.external_ids?.imdb_id;
      payload.seasons = (data.seasons || [])
        .filter((s) => s.season_number !== 0)
        .map((s) => ({
          season_number: s.season_number,
          name: s.name,
          poster: s.poster_path
            ? `https://image.tmdb.org/t/p/w500${s.poster_path}`
            : 'https://placehold.co/300x450?text=No+Image',
          episode_count: s.episode_count,
        }));
    }

    res.json(payload);
  } catch (err) {
    console.error('TMDB details failed:', err.message);
    res.status(500).json({ error: 'TMDB details failed', details: err.message });
  }
});

// Route: /details
app.get('/details', async (req, res) => {
  const id = req.query.id;
  const type = req.query.type || 'movie';

  if (!id) return res.status(400).json({ error: 'Missing TMDB ID' });

  try {
    // Main details
    const response = await axios.get(`https://api.themoviedb.org/3/${type}/${id}`, {
      params: {
        api_key: TMDB_API_KEY,
        append_to_response: 'external_ids,videos',
      },
    });

    const data = response.data;

    // Get trailer from TMDB videos
    const trailer = data.videos?.results?.find(
      (v) => v.type === 'Trailer' && v.site === 'YouTube'
    );
    const trailerUrl = trailer ? `https://www.youtube.com/embed/${trailer.key}` : null;

    // Get similar movies (only for movies)
    let similar = [];
    if (type === 'movie') {
      const simRes = await axios.get(`https://api.themoviedb.org/3/movie/${id}/similar`, {
        params: {
          api_key: TMDB_API_KEY,
          language: 'en-US',
          page: 1,
        },
      });

      similar = simRes.data.results
        .filter((m) => m.poster_path)
        .slice(0, 10)
        .map((m) => ({
          tmdb_id: m.id,
          title: m.title,
          poster: `https://image.tmdb.org/t/p/w500${m.poster_path}`,
          rating: m.vote_average,
          year: m.release_date?.split('-')[0],
        }));
    }

    // Main data
    const payload = {
      tmdb_id: id,
      title: data.title || data.name,
      description: data.overview || '',
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path
        ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
        : null,
      release_date: data.release_date || data.first_air_date,
      runtime: data.runtime || null,
      genres: (data.genres || []).map((g) => g.name),
      embedUrl:
        type === 'movie'
          ? `https://vidsrc.to/embed/movie/${id}`
          : `https://vidsrc.to/embed/tv/${data.external_ids?.imdb_id || id}`,
      trailerUrl,
      similar,
      type,
    };

    // TV-only extras
    if (type === 'tv') {
      payload.imdb_id = data.external_ids?.imdb_id;
      payload.seasons = (data.seasons || [])
        .filter((s) => s.season_number !== 0)
        .map((s) => ({
          season_number: s.season_number,
          name: s.name,
          poster: s.poster_path
            ? `https://image.tmdb.org/t/p/w500${s.poster_path}`
            : 'https://placehold.co/300x450?text=No+Image',
          episode_count: s.episode_count,
        }));
    }

    res.json(payload);
  } catch (err) {
    console.error('TMDB details failed:', err.message);
    res.status(500).json({ error: 'TMDB details failed', details: err.message });
  }
});

// Route: /embed
app.get('/embed', (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing TMDB or IMDb ID' });

  const embedUrl = `https://vidsrc.to/embed/movie/${id}`;
  res.json({ embedUrl });
});
// Add this route to your server.js to fetch episodes of a specific season for a TV show

app.get('/episodes', async (req, res) => {
  const tv_id = req.query.tv_id;
  const season_number = req.query.season;

  if (!tv_id || !season_number) {
    return res.status(400).json({ error: 'Missing tv_id or season' });
  }

  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/tv/${tv_id}/season/${season_number}`,
      { params: { api_key: TMDB_API_KEY } }
    );

    const episodes = response.data.episodes.map((ep) => ({
      name: ep.name,
      overview: ep.overview,
      still: ep.still_path
        ? `https://image.tmdb.org/t/p/w500${ep.still_path}`
        : null,
      episode_number: ep.episode_number,
      air_date: ep.air_date,
    }));

    res.json(episodes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch episodes', details: err.message });
  }
});
// Route: /preload
// 👇 Add this helper above the route
const enrichData = async (items, type) => {
  return await Promise.all(
    items
      .filter((item) => item.poster_path)
      .slice(0, 10)
      .map(async (item) => {
        const details = await axios.get(`https://api.themoviedb.org/3/${type}/${item.id}`, {
          params: { api_key: TMDB_API_KEY },
        });

        const releaseYear = (item.release_date || item.first_air_date || '').slice(0, 4);
        const runtime = details.data.runtime || details.data.episode_run_time?.[0] || null;

        return {
          ...normalizeTMDBItem(item, type),
          rating: item.vote_average,
          year: releaseYear,
          runtime,
        };
      })
  );
};

// 👇 Replace your old /preload route with this
app.get('/preload', async (req, res) => {
  try {
    const [trendingRes, nowPlayingRes, topRatedRes] = await Promise.all([
      axios.get('https://api.themoviedb.org/3/trending/movie/day', {
        params: { api_key: TMDB_API_KEY },
      }),
      axios.get('https://api.themoviedb.org/3/movie/now_playing', {
        params: { api_key: TMDB_API_KEY },
      }),
      axios.get('https://api.themoviedb.org/3/movie/top_rated', {
        params: { api_key: TMDB_API_KEY },
      }),
    ]);

    const [tvTrendingRes, tvTopRatedRes] = await Promise.all([
      axios.get('https://api.themoviedb.org/3/trending/tv/day', {
        params: { api_key: TMDB_API_KEY },
      }),
      axios.get('https://api.themoviedb.org/3/tv/top_rated', {
        params: { api_key: TMDB_API_KEY },
      }),
    ]);

    // 🎯 Editor's Picks = High vote average + enough votes
    const editorsRes = await axios.get('https://api.themoviedb.org/3/discover/movie', {
      params: {
        api_key: TMDB_API_KEY,
        sort_by: 'vote_average.desc',
        vote_count_gte: 100,
        include_adult: false,
        language: 'en-US',
        page: 1,
      },
    });

    // 📅 Upcoming Movies
    const upcomingRes = await axios.get('https://api.themoviedb.org/3/movie/upcoming', {
      params: {
        api_key: TMDB_API_KEY,
        language: 'en-US',
        page: 1,
      },
    });

    res.json({
      trending: await enrichData(trendingRes.data.results, 'movie'),
      nowPlaying: await enrichData(nowPlayingRes.data.results, 'movie'),
      topRated: await enrichData(topRatedRes.data.results, 'movie'),
      editors: await enrichData(editorsRes.data.results, 'movie'),
      upcoming: await enrichData(upcomingRes.data.results, 'movie'),
      tvTrending: await enrichData(tvTrendingRes.data.results, 'tv'),
      tvTopRated: await enrichData(tvTopRatedRes.data.results, 'tv'),
    });
  } catch (err) {
    console.error('Preload fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch preload data', details: err.message });
  }
});

// ✅ Top Rated by Genre
app.get('/explore/toprated', async (req, res) => {
  const { type = 'movie', genreId } = req.query;

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, {
      params: {
        api_key: TMDB_API_KEY,
        sort_by: 'vote_average.desc',
        'vote_count.gte': 300, // ✅ Corrected key
        with_genres: genreId,
        include_adult: false,
        include_video: false,
        'with_original_language': 'en',
        language: 'en-US',
        page: 1,
      },
    });

    const results = response.data.results
      .filter(item => item.poster_path)
      .map(item => normalizeTMDBItem(item, type));

    res.json(results);
  } catch (err) {
    console.error('Top Rated fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Top Rated fetch failed' });
  }
});
// ✅ Fan Favorites (by popularity)
app.get('/explore/favorites', async (req, res) => {
  const { type = 'movie', genreId } = req.query;

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, {
      params: {
        api_key: TMDB_API_KEY,
        sort_by: 'popularity.desc',
        'vote_count.gte': 300, // ✅ Correct syntax and increased quality threshold
        with_genres: genreId,
        include_adult: false,
        include_video: false,
        'with_original_language': 'en',
        language: 'en-US',
        page: 1,
      },
    });

    const results = response.data.results
      .filter(item => item.poster_path)
      .map(item => normalizeTMDBItem(item, type));

    res.json(results);
  } catch (err) {
    console.error('Fan Favorites fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Fan Favorites fetch failed' });
  }
});
// ✅ Upcoming (for movies only)
app.get('/explore/upcoming', async (req, res) => {
  const { type = 'movie', genreId } = req.query;

  if (type !== 'movie') return res.json([]); // TMDB doesn't support /upcoming for TV

  try {
    const response = await axios.get('https://api.themoviedb.org/3/movie/upcoming', {
      params: {
        api_key: TMDB_API_KEY,
        language: 'en-US',
        region: 'US', // Optional: helps narrow down to relevant releases
        page: 1,
      },
    });

    const results = response.data.results
      .filter(item =>
        item.poster_path &&
        (!genreId || item.genre_ids.includes(Number(genreId))) &&
        item.original_language === 'en'
      )
      .sort((a, b) => b.popularity - a.popularity) // Optional: sort by popularity
      .map(item => normalizeTMDBItem(item, type));

    res.json(results);
  } catch (err) {
    console.error('Upcoming fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Upcoming fetch failed' });
  }
});
// ✅ Editor's Picks (shuffled top-rated by genre)
app.get('/explore/editors', async (req, res) => {
  const { type = 'movie', genreId } = req.query;

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, {
      params: {
        api_key: TMDB_API_KEY,
        sort_by: 'vote_average.desc',
        'vote_count.gte': 300, // ✅ Corrected key and bumped for quality
        with_genres: genreId,
        include_adult: false,
        include_video: false,
        'with_original_language': 'en',
        language: 'en-US',
        page: 1,
      },
    });

    const shuffled = response.data.results
      .filter(item => item.poster_path && (item.title || item.name))
      .sort(() => 0.5 - Math.random()) // 🎲 Shuffle for variety
      .slice(0, 10)
      .map(item => normalizeTMDBItem(item, type));

    res.json(shuffled);
  } catch (err) {
    console.error("Editor's Picks fetch failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Editor's Picks fetch failed" });
  }
});


// Add to your server.js
// Add to your server.js
app.get('/genre/viewall', async (req, res) => {
  const {
    id,
    type = 'movie',
    sort_by = 'vote_average.desc',
    page = 1,
    vote_count_gte,
    vote_average_gte,
    with_original_language,
    primary_release_date_gte,
    with_runtime_gte,
  } = req.query;

  if (!id) return res.status(400).json({ error: 'Missing genre id' });

  try {
    // 🔒 Clean and safe TMDB query params
    const tmdbParams = {
      api_key: process.env.TMDB_API_KEY,
      with_genres: id,
      sort_by,
      include_adult: false,
      include_video: false,
      language: 'en-US',
      page,
    };

    // 🛡 Enforce vote count when sorting by rating (no fake indies)
    if (sort_by === 'vote_average.desc' && !vote_count_gte) {
      tmdbParams['vote_count.gte'] = 300;
    } else if (vote_count_gte) {
      tmdbParams['vote_count.gte'] = vote_count_gte;
    }

    // ✅ Clean optional filters
    if (vote_average_gte) tmdbParams['vote_average.gte'] = vote_average_gte;
    if (with_original_language) tmdbParams['with_original_language'] = with_original_language;
    if (primary_release_date_gte) tmdbParams['primary_release_date.gte'] = primary_release_date_gte;
    if (with_runtime_gte) tmdbParams['with_runtime.gte'] = with_runtime_gte;

    // 🛰 Fetch TMDB results
    const discoverRes = await axios.get(`https://api.themoviedb.org/3/discover/${type}`, {
      params: tmdbParams,
    });

    const baseItems = discoverRes.data.results
      .filter(item => item.id && item.poster_path && (item.title || item.name))
      .map(item => normalizeTMDBItem(item, type));

    // 🧠 Enrich with runtime & genres
    const enriched = await Promise.all(
      baseItems.map(async (item) => {
        try {
          const detailsRes = await axios.get(`https://api.themoviedb.org/3/${type}/${item.tmdb_id}`, {
            params: { api_key: process.env.TMDB_API_KEY },
          });

          const runtime = detailsRes.data.runtime || detailsRes.data.episode_run_time?.[0] || null;
          const genres = (detailsRes.data.genres || []).map(g => g.name);

          return {
            ...item,
            runtime,
            genres,
          };
        } catch (err) {
          console.warn(`Failed to enrich ${item.title}`, err.message);
          return item;
        }
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error('View All fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch view all content' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
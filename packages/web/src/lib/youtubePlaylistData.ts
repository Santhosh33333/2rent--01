/**
 * The playlist catalogue behind /music.
 *
 * PROVENANCE, so nobody has to guess how this list came to be:
 *
 * Every entry here was collected by searching youtube.com for Tamil love,
 * romantic, melody, sad, jukebox, kuthu and era-specific music, and every id was
 * then resolved against YouTube's oEmbed endpoint. Only playlists that resolved
 * are listed. Roughly a third of the ids that appear in search results do not
 * resolve at all - YouTube's search surfaces ids for playlists that have been
 * deleted or made unlisted, and those return 404 on the playlist page itself.
 * Those are left out rather than shipped as rows that cannot play.
 *
 * Titles and channel names are copied verbatim from that oEmbed response. None
 * are paraphrased, translated or invented. If a playlist is renamed on YouTube
 * this file will keep showing the old title until it is refreshed - the fix is
 * to re-resolve the id, not to hand-edit the string.
 *
 * To refresh or verify one:
 *
 *   https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3D<ID>&format=json
 *
 * ORDER is meaningful: love and romantic playlists come first because this is a
 * dating product and those are what the page is for. Broader Tamil music,
 * jukeboxes and kuthu collections follow. The picker sorts by relevance order,
 * not alphabetically, so the first screen is the relevant one.
 *
 * A NOTE ON HYPHENS, which has already cost one playlist:
 *
 * Several of these ids end in, or contain, a hyphen. That is not stray
 * punctuation - removing a character yields a different id that 404s. Both ids
 * below with a trailing hyphen were verified in place, and one of them was
 * nearly discarded as a typo. Do not "tidy" these strings.
 */
import type { YoutubePlaylist } from './youtubePlaylist'

export const YOUTUBE_PLAYLISTS_DATA: readonly YoutubePlaylist[] = [
  // ---- Love and romantic ------------------------------------------------
  // The trailing hyphen below is part of the id. Without it this 404s.
  {
    id: 'PL4DBJO4oXOF06bm7ntRQgXioxhMCSFOW-',
    title:
      'Love Songs 2026 Tamil - Best Love Tamil Songs 2026 Mashup (Tamil Love Songs Playlist 2026)',
    author: 'Redlist - Mejores Exitos',
  },
  {
    id: 'PL_DaWb6RFQc35Mrbl8ZsKp08tJFfPGGfs',
    title: 'Best Love Songs | Tamil Love Songs',
    author: 'Sony Music South',
  },
  {
    id: 'PLtfYbW1flhRXVuryi0-2sHwFElVvyndzY',
    title: 'Latest Tamil Love Songs',
    author: 'Tips Tamil',
  },
  {
    id: 'PLf4gNFQAb3MKQ4uLt2FwGXRN0XCM0fANu',
    title:
      'Love Songs 2026 Tamil - Top Romantic Tamil Songs 2026 (Love Tamil Music Playlist 2026)',
    author: 'Redlist - Lista Exitos',
  },
  {
    id: 'PL_rXc1ssylNdHI4NR_eZEBekqFCqpNGyH',
    title: 'Tamil Romantic Songs  |  Tamil Melody Songs  2010 - 2025',
    author: 'Only Music',
  },
  {
    id: 'PLviYSX9LX22bmLVB2GorelD7N-xXwwYLx',
    title: 'Evergreen Love Zone | Top love hits | Saregama Tamil',
    author: 'Saregama Tamil',
  },
  {
    id: 'PLF0p4MtOouIJl6we_7n5RdWUQ_7EZaCPh',
    title: 'Love mood songs',
    author: 'Divaas Trek',
  },
  {
    id: 'PL4eWmTehVMLFUpG7LlTy_6nCO5dWNzbtq',
    title: 'Love hurts Tamil songs - love feel',
    author: 'Yuvaraj Kumar',
  },
  {
    id: 'PLxvq2VAujPphWS23_qaFb0Jt0yeERPzpX',
    title: "Love failure's sad songs Tamil",
    author: 'Anbu Tamil Studios',
  },
  {
    id: 'PLok1yjXMR-I9XzUy10JJD7H6Cpqhb95ql',
    title: 'Love failure Songs',
    author: 'Karthi petchimuthu',
  },
  {
    id: 'PL0vJrJNk8Upf4gdp99f3lBjQ5a8qLK211',
    title: 'Love Breakup Songs Tamil',
    author: 'Kutty Tamizhan',
  },
  {
    id: 'PLcwMDkjf2adIt_Fa4nVqF3rq27mVEMih-',
    title: 'Tamil old love failure songs',
    author: 'PonnarasuFT',
  },
  {
    id: 'PLINlNyzYHUVwMqaWyf9wkR2rNjVUnj7u4',
    title: 'Tamil love failure songs',
    author: 'Vishnu Vvs',
  },
  {
    id: 'PLJczYthX8zIYJectVmvtePOtUKeK0lCP5',
    title: 'Breakup songs Tamil\u{1F494}',
    author: "Batman Creation's",
  },
  {
    id: 'PLJICwt4_3429YL0hhj5D_qB77cigmzCYE',
    title: '\u{1F495}Tamil Cute Pair love whatsApp status\u{1F495}',
    author: 'Gowsi Beats',
  },
  {
    id: 'PLrhlB2rEUnu09RggvfVmawFYzjLUKpwJn',
    title:
      'Tamil Love Songs full screen WhatsApp Status|Tamil WhatsApp Status Video|Tamil love songs WhatsApp Status video| Tamil songs|',
    author: 'PS Nanban Creation',
  },

  // ---- BGM, ringtones and short romantic clips --------------------------
  // The closest thing here to the app's own ambient audio, in spirit only.
  {
    id: 'PLq2mubq9FQlOcGJljo0I2xzOYx_v_bviJ',
    title:
      'new tamil love bgm ringtone 2025 | romantic south indian ringtone | trending bgm tone',
    author: 'Mojo Music Studio',
  },
  {
    id: 'PLHf0rfE4tFT3S4F1VMUCrYqaEJCdR7HLF',
    title:
      'New Melody bgmringtones 2025 | trending new tamil bgm ringtone | ringtone download',
    author: 'Maja Ringtone',
  },
  {
    id: 'PLy7itXB2y52cyMo5kc8Cg82Uw2erNNaAe',
    title: 'Tamil BGM collection',
    author: 'Madhavan K',
  },
  {
    id: 'PLIAF7l6nyeQbCM6jHc1D8XJq984807Rq9',
    title: 'Love Bgm Ringtones',
    author: 'AA BGM',
  },

  // ---- Melody -----------------------------------------------------------
  {
    id: 'PLVEWIxIKE6FCVFt5F3YC51iMsxIiYuVSR',
    title: '2017-2018 tamil melody hit songs',
    author: 'Jim eliot Jebastin',
  },
  {
    id: 'PLj5cReMoN9UZutgUTENyw4Fxd1bXqrT2B',
    title: 'Tamil Melody Songs 2017 Love Songs 2017',
    author: 'Jame Taylor',
  },
  {
    id: 'PLvVhCQ7o6mqYHBKnb-NaLq8vXW81o5LgB',
    title: '2k Tamil melody songs',
    author: 'Luxixual',
  },
  {
    id: 'PL1Lj8gqn_yNFh-R4ra6nS6P9lKDHamd2c',
    title: '2000 melody tamil songs',
    author: 'Soundarya Srinivasan',
  },
  {
    id: 'PLQUQEdDh8a6xtNanm_pjGEzhe_vOl6DmX',
    title: '2k melody songs tamil \u{1F60D}\u{1F48B}\u{1F648}',
    author: 'taekook',
  },
  {
    id: 'PL3pw6hROvJZvQB25Gf_0sg_RrINnM2abU',
    title: 'Tamil Pleasant and Melody Songs 2013-15',
    author: 'Govind Balan',
  },
  {
    id: 'PL72CeoyUmcfcWiubTYhXTCUH-2TJ43xxs',
    title: 'Ilayaraja melody collection',
    author: 'Evergreen songs',
  },
  {
    id: 'PLII5DKuZWC1vC6BGqaTVVux2nInUwAbtg',
    title: 'GV Prakash Melody Hits \u{1F49D}',
    author: 'Randy Buresh',
  },
  {
    id: 'PLHCsKFtO0ZWk_NHNuCCQlOuypHDhuuZqE',
    title: 'Soulful tamil songs',
    author: 'Sathish Kumar',
  },
  {
    id: 'PLw6_eBQhr30NH9YgTGpONDACV-abdLzfA',
    title: 'Tamil ( Slowed + Reverb ) Songs \u{1F629}\u{1F497}',
    author: 'Milex Beats',
  },
  {
    id: 'PLmd_lI_M7LExKv3Hv_M4GfCpv7zvO29mL',
    title: 'Tamil slow+reverb (songs)',
    author: 'HEMANTH.M',
  },

  // ---- Sad and heartbreak ----------------------------------------------
  {
    id: 'PLu6mwn7cpt6YFOoBydG6zIN9s9FtkeoM_',
    title: 'Slow moving/sad songs tamil movies',
    author: 'Prem C Leonidas',
  },
  {
    id: 'PLjity7Lwv-zpZ8JV6kS75KEGj2lL2f1Vc',
    title:
      'Tamil Sad Songs | Tamil Love Sad Songs | Tamil Sad Songs Collections | Tamil New Sad Songs | Tamil Old Sad Songs | Tamil Sad Songs Jukebox 2020',
    author: 'SPR Prime Media',
  },
  {
    id: 'PLtO4Tw6wxDpwVjkLIuIAEPtjb96s9Yomy',
    title: 'Yuvan Tamil Sad songs',
    author: 'Jawahar',
  },
  {
    id: 'PL7FwPiNtqcAsV5qIJ-JHXH3ftksx5MyIQ',
    title: 'Tamil Sad song',
    author: 'Pradip Ravichandran',
  },
  {
    id: 'PLA-8U9tOtMXtknM6lZbXOyobtRoK2xPQt',
    title: 'Tamil Sad songs \u{1F494}\u{1F614}',
    author: 'Arunchandran',
  },

  // ---- Wedding ----------------------------------------------------------
  {
    id: 'PLxoTJe9y3VSnTa7W5ICEqCMQACNM6rs3t',
    title: 'Tamil Wedding Songs',
    author: 'Gunawathi Ramachandran',
  },
  {
    id: 'PLaX5sQ37-wtoy5WgRIarJPipiCZ--1qex',
    title: 'wedding songs tamil',
    author: 'ganeshalingam ameliny',
  },

  // ---- Composer and era collections -------------------------------------
  {
    id: 'PL89t04T3yNyYT690i3CzPJzYYzZ3kws9_',
    title:
      'Audio Jukebox | Evergreen Tamil Movie Songs | Non Stop Ilaiyaraaja Hits',
    author: 'Ilaiyaraaja Official',
  },
  {
    id: 'PL0rVrRHZm_D5u3Oj8VaB1Jofd2h2QbwjD',
    title:
      'இளையராஜா ஹிட்ஸ்/ Ilaiyaraaja hits 1080p HD Tamil video song and 4k video Song/illaiyaraja super hits and melody song/',
    author: 'Tamil Jet hits',
  },
  {
    id: 'PLTJtsvoz77eBXx2UeuB_tDLWsxAM46GL_',
    title: 'ILAYARAJA 5,1 AUDIO',
    author: 'Mohamed Rasik Ali',
  },
  {
    id: 'PL-TP2QEUBAohkzwi6MnWbcNe0PcGoUON2',
    title: 'ilayaraja hits 80s 90s',
    author: 'Enjoy Enjammi',
  },
  {
    id: 'PL0rVrRHZm_D5jEXAlpEcRGOXK3tStzwq8',
    title:
      "S.A.Rajkumar mega hits 1080p HD Tamil video song and 4k video Song/music director,singer/S.A.Rajkumar 90'S super hits and melody song",
    author: 'Tamil Jet hits',
  },
  {
    id: 'PL5ILUyaiEiv9Ry8K4gmKJEiy9Lu7XasEb',
    title: 'SPB hits in tamil',
    author: 'soundar pandi',
  },
  {
    id: 'PL-TP2QEUBAogwpaipKiUNUNfDWiNQUBlf',
    title: 'Mic Mohan Hits \u{1F399}\u{1F3BC}',
    author: 'Enjoy Enjammi',
  },
  {
    id: 'PLPS5Bdy5POBqu73Ju1bR2gpLvKbPqx-Q7',
    title: 'GV Prakash',
    author: 'kirthanambigai subramaniam',
  },
  {
    id: 'PLdlYJcwGtmE7HWY4218zeCpiqUCZ-y8QH',
    title: 'Yuvan Raja Hits',
    author: 'POORNESH 15BME0036',
  },
  {
    id: 'PLQC9EmNrj6-HjbZpflpmwMKYuCqRJgo_N',
    title:
      '#1990s#90s#Tamil songs#Tamil music#hariharan songs#spb hits#vijay#ajith#prasanth',
    author: 'Tamil Hits',
  },
  {
    id: 'PLz1kLm0dx0qL39ZUJ5JiWGyJw-0iPMiiu',
    title: '90s Kids Tamil Songs.',
    author: 'Sivakumar A',
  },
  {
    id: 'PLcRErFRHYI-iY-IolU-vjxa0f3rr_Kdbi',
    title: 'Early 2000s Tamil Songs',
    author: 'Abhinav Surya',
  },
  {
    id: 'PLb0itrUAmjQMPJMInT9UBEDXTEs0Y50xx',
    title: '2010 to 2019 tamil hit songs',
    author: 'Aravind Puli',
  },
  {
    id: 'PLw8x4Qhl3wlgCFQzpyyLWh9XgGPe-LaXs',
    title: 'Tamil Songs Jukebox Non-Stop',
    author: 'RR Tamil Entertainment',
  },

  // ---- Broad Tamil hits -------------------------------------------------
  {
    id: 'PLHuHXHyLu7BG-gV5fc8y_jir4rKtUPHKr',
    title: 'Top Tamil Hits Songs',
    author: 'Sony Music India',
  },
  {
    id: 'PLd_daisa6ICM3_1N8l0Agry2-9Hf3lyEo',
    title: 'All time Tamil hit songs',
    author: 'kesavraj',
  },
  {
    id: 'PL3oW2tjiIxvTaC6caIGR55W3ssqGvb_LR',
    title: 'Tamil Songs 2026 \u{266B}  Latest Tamil Hits 2026',
    author: 'Redlist - Biggest Songs',
  },
  {
    id: 'PL8IylWRo2wQxyB4LPWOhyz1qcqNLhJLiu',
    title: 'Latest tamil album hits | hits songs tamil album',
    author: 'Devi 8D songs',
  },
  {
    id: 'PLYloDMfA37Gfr-a1l9nzC0YON-3gyl-83',
    title: 'Latest Tamil Songs 2024!',
    author: 'Aditya Music Tamil',
  },
  {
    id: 'PLGjAbxgreXJyNwLxGNECXs4Yaqo3_z1aD',
    title: 'Tamil independent hit songs',
    author: 'Styler Seven Forever',
  },
  {
    id: 'PL-SbjTK4rra7fJYLtvAhhFfqMxOttGgGn',
    title: 'Saregama playlist',
    author: 'Sathis Sarigama Music Official ',
  },
  {
    id: 'PLpNEDnwMNFC4ZKJ-Od38LVG2qeAtkUNsG',
    title: 'Town Bus Songs Tamil',
    author: 'Dj Prabhu Official',
  },

  // ---- Kuthu ------------------------------------------------------------
  {
    id: 'PLEX9PIR-5zwc-I1_kSUrpALy-wWZrnh5e',
    title: 'Tamil Kuthu 2000-2010',
    author: 'Chaandini Ranganathan',
  },
  {
    id: 'PLCvqoYckCSVYKhylGWplxb1jo56AQI7sg',
    title: 'Tamil Kuthu Songs',
    author: 'Venkatachalam Subramanian',
  },
  {
    id: 'PLRMJIvNrS-_nD1_KKu68pF_5lADvfsv1r',
    title: 'Tamil kuthu songs',
    author: 'Girish Kumar',
  },
  {
    id: 'PLuPNjfP_7p_4kZCyHXJtjzgNtO0B02yIE',
    title: 'Kuthu Songs',
    author: 'DK Editzzz',
  },
]
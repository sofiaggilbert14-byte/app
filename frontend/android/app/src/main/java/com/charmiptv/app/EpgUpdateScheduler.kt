package com.charmiptv.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

internal object EpgUpdateScheduler {
  private const val UNIQUE_WORK = "charm-epg-update-scheduler"

  fun install(context: Context) {
    val request = PeriodicWorkRequestBuilder<EpgUpdateWorker>(1, TimeUnit.HOURS)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
      UNIQUE_WORK,
      ExistingPeriodicWorkPolicy.UPDATE,
      request,
    )
  }
}

internal class EpgUpdateWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result {
    val nowSeconds = System.currentTimeMillis() / 1000L
    val dao = EpgControlDatabase.get(applicationContext).dao()
    var due = false
    for (source in dao.enabledSources()) {
      val state = dao.importState(source.playlistId)
      if ((state?.blackoutUntilSeconds ?: 0L) > nowSeconds) continue
      val lastSuccess = state?.lastSuccessSeconds ?: 0L
      if (lastSuccess == 0L || nowSeconds - lastSuccess >= source.refreshHours.coerceIn(1, 168) * 3600L) {
        due = true
        break
      }
    }
    applicationContext.getSharedPreferences("charm_epg_scheduler", Context.MODE_PRIVATE)
      .edit().putBoolean("refresh_due", due).putLong("checked_at_seconds", nowSeconds).apply()
    return Result.success()
  }
}

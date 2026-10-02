package com.axcrew.android

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.*
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.DisposableEffect
import com.axcrew.android.feature.CrewViewModel
import com.axcrew.android.navigation.CrewApp
import com.axcrew.android.ui.CrewTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setContent {
            val vm: CrewViewModel = viewModel()
            DisposableEffect(vm) {
                val lifecycle = ProcessLifecycleOwner.get().lifecycle
                val observer = LifecycleEventObserver { _, _ -> vm.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
                lifecycle.addObserver(observer)
                vm.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                onDispose { lifecycle.removeObserver(observer) }
            }
            CrewTheme { CrewApp(vm) }
        }
    }
}
